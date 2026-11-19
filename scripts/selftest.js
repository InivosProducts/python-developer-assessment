// Local check: builds many papers, verifies the mix, and runs a full start -> submit cycle with Mailgun stubbed.
process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "local-test-secret-1234567890";
process.env.MAILGUN_API_KEY = "x"; process.env.MAILGUN_DOMAIN = "example.mailgun.org"; process.env.RESULTS_TO = "test@example.com";
const assert = require("assert");
const { buildPaper, publicPaper, MODULES } = require("../lib/paper");
let sent = null, mgValidate = null;
global.fetch = async (url, opts = {}) => {
  if (url.includes("/address/validate")) {
    const addr = new URL(url).searchParams.get("address");
    if (mgValidate === "down") return { ok: false, status: 402, text: async () => "payment required" };
    return { ok: true, json: async () => ({ address: addr, result: addr.startsWith("nobody@") ? "undeliverable" : "deliverable", did_you_mean: addr.startsWith("nobody@") ? "somebody@example.com" : undefined }) };
  }
  sent = { url, body: Object.fromEntries(new URLSearchParams(opts.body)) }; return { ok: true, text: async () => "ok" };
};

// Fake DNS so the test runs offline.
const emailCheck = require("../lib/email-check");
const err = (code) => Promise.reject(Object.assign(new Error(code), { code }));
const DNS = {
  "example.com": { mx: [{ exchange: "mx.example.com", priority: 10 }] },
  "gmail.com": { mx: [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }] },
  "a-only.org": { mx: "ENODATA", a: ["1.2.3.4"] },
  "nomail.org": { mx: [{ exchange: ".", priority: 0 }] },
  "empty.org": { mx: "ENODATA", a: "ENODATA", aaaa: "ENODATA" },
  "flaky.org": { mx: "ESERVFAIL" },
  "gmial.com": { mx: [{ exchange: "mx.gmial.com", priority: 10 }] },
};
const look = (d, k) => { const v = DNS[d] ? DNS[d][k] : "ENOTFOUND"; return Array.isArray(v) ? Promise.resolve(v) : err(v || "ENODATA"); };
emailCheck.resolver.resolveMx = (d) => look(d, "mx");
emailCheck.resolver.resolve4 = (d) => look(d, "a");
emailCheck.resolver.resolve6 = (d) => look(d, "aaaa");

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

  // Email existence checks run before any code is sent.
  const ask = async (email, extra = {}) => { sent = null; const r = res(); await verifyEmail({ method: "POST", body: { name: "Test Candidate", email, ...extra } }, r); return r; };
  let r;
  r = await ask("someone@gmial.com"); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.reason, "typo"); assert.strictEqual(r.body.suggestion, "someone@gmail.com"); assert.strictEqual(sent, null, "no email for a typo");
  r = await ask("someone@gmial.com", { skipTypoCheck: true }); assert.strictEqual(r.code, 200, "candidate can keep a flagged domain if it accepts mail");
  r = await ask("someone@company.con"); assert.strictEqual(r.body.suggestion, "someone@company.com");
  r = await ask("someone@ymail.com"); assert.notStrictEqual(r.body.reason, "typo", "real providers are not typos");
  r = await ask("someone@no-such-domain-xyz.com"); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.reason, "domain"); assert.strictEqual(sent, null);
  r = await ask("someone@nomail.org"); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.reason, "domain");
  r = await ask("someone@empty.org"); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.reason, "domain");
  r = await ask("someone@a-only.org"); assert.strictEqual(r.code, 200, "A-record fallback accepted");
  r = await ask("someone@flaky.org"); assert.strictEqual(r.code, 200, "DNS errors fail open");
  r = await ask("nobody@example.com"); assert.strictEqual(r.code, 200, "mailbox check is off by default");
  const realMx = emailCheck.resolver.resolveMx; emailCheck.resolver.resolveMx = () => err("ENOTFOUND");
  r = await ask("someone@example.com"); assert.strictEqual(r.code, 200, "broken server DNS fails open");
  emailCheck.resolver.resolveMx = realMx;
  process.env.MAILGUN_VALIDATION = "on";
  r = await ask("nobody@example.com"); assert.strictEqual(r.code, 400); assert.strictEqual(r.body.reason, "mailbox"); assert.strictEqual(r.body.suggestion, "somebody@example.com"); assert.strictEqual(sent, null);
  r = await ask("cand@example.com"); assert.strictEqual(r.code, 200);
  mgValidate = "down"; r = await ask("nobody@example.com"); assert.strictEqual(r.code, 200, "Mailgun validation outage fails open"); mgValidate = null;
  delete process.env.MAILGUN_VALIDATION;
  process.env.EMAIL_DOMAIN_CHECK = "off";
  r = await ask("someone@no-such-domain-xyz.com"); assert.strictEqual(r.code, 200, "domain check can be turned off");
  delete process.env.EMAIL_DOMAIN_CHECK;

  console.log("OK  1000 papers valid, no answers leaked, email verification enforced, email existence checks, tamper rejected");
  console.log("Email subject:", sent.body.subject);
})().catch(e => { console.error(e); process.exit(1); });
