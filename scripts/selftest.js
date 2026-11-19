// Local check: builds many papers, verifies the mix, and runs a full start -> submit cycle with Mailgun stubbed.
process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "local-test-secret-1234567890";
process.env.MAILGUN_API_KEY = "x"; process.env.MAILGUN_DOMAIN = "example.mailgun.org"; process.env.RESULTS_TO = "test@example.com";
const assert = require("assert");
const { buildPaper, publicPaper, MODULES } = require("../lib/paper");
let sent = null;
global.fetch = async (url, opts) => { sent = { url, body: Object.fromEntries(new URLSearchParams(opts.body)) }; return { ok: true, text: async () => "ok" }; };

for (let s = 100000; s < 101000; s++) {
  const p = buildPaper(s);
  assert.strictEqual(p.length, 20);
  assert.strictEqual(p.filter(q => q.type === "text").length, 6);
  assert.strictEqual(new Set(p.map(q => q.id)).size, 20);
  const per = {}; p.forEach(q => per[q.m] = (per[q.m] || 0) + 1);
  assert.strictEqual(Object.keys(per).length, MODULES.length);
  Object.values(per).forEach(v => assert.ok(v >= 2 && v <= 3));
  const pub = JSON.stringify(publicPaper(p));
  assert.ok(!/"a":|"keys"|"model"|"why"/.test(pub), "answers leaked to client");
}
const res = () => { const r = { code: 0, body: null, headers: {} }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); r.setHeader = (k, v) => r.headers[k] = v; return r; };
(async () => {
  const start = require("../api/start"), submit = require("../api/submit"), verifyEmail = require("../api/verify-email");

  // Email verification (default): request a code, then start with it.
  const bad = res(); await verifyEmail({ method: "POST", body: { name: "Test Candidate", email: "not-an-email" } }, bad);
  assert.strictEqual(bad.code, 400);
  const v = res(); await verifyEmail({ method: "POST", body: { name: "Test Candidate", email: " Cand@Example.com " } }, v);
  assert.strictEqual(v.code, 200);
  assert.strictEqual(sent.body.to, "cand@example.com");
  const code = sent.body.subject.match(/(\d{6})$/)[1];
  assert.ok(!JSON.stringify(v.body).includes(code), "code leaked to client");
  const wrong = String((+code + 1) % 1000000).padStart(6, "0");
  const r0 = res(); await start({ method: "POST", body: { challenge: v.body.challenge, code: wrong } }, r0);
  assert.strictEqual(r0.code, 400);
  const r0b = res(); await start({ method: "POST", body: { name: "No Email" } }, r0b);
  assert.strictEqual(r0b.code, 400, "start without verification must be rejected");
  const r1 = res(); await start({ method: "POST", body: { challenge: v.body.challenge, code } }, r1);
  assert.strictEqual(r1.code, 200);
  assert.strictEqual(r1.body.email, "cand@example.com");
  // A challenge token must not be accepted as a test token.
  const rx = res(); await submit({ method: "POST", body: { token: v.body.challenge, answers: [] } }, rx);
  assert.strictEqual(rx.code, 400);

  const answers = r1.body.paper.map(q => q.type === "mcq" ? 0 : "isolate and replace external dependencies with a mock using patch");
  const r2 = res(); await submit({ method: "POST", body: { token: r1.body.token, answers } }, r2);
  assert.strictEqual(r2.code, 200); assert.ok(r2.body.emailed);
  assert.ok(sent.body.subject.includes("Test Candidate"));
  assert.strictEqual(sent.body.to, "test@example.com");
  assert.ok(sent.body.text.includes("Email: cand@example.com"));
  const r3 = res(); await submit({ method: "POST", body: { token: r1.body.token.replace(/.$/, "x"), answers } }, r3);
  assert.strictEqual(r3.code, 400);

  // EMAIL_VERIFICATION=off keeps the old name-only flow.
  process.env.EMAIL_VERIFICATION = "off";
  const r4 = res(); await start({ method: "POST", body: { name: "Test Candidate" } }, r4);
  assert.strictEqual(r4.code, 200);
  delete process.env.EMAIL_VERIFICATION;

  console.log("OK  1000 papers valid, no answers leaked, email verification enforced, tamper rejected");
  console.log("Email subject:", sent.body.subject);
})().catch(e => { console.error(e); process.exit(1); });
