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
  const start = require("../api/start"), submit = require("../api/submit");
  const r1 = res(); await start({ method: "POST", body: { name: "Test Candidate" } }, r1);
  assert.strictEqual(r1.code, 200);
  const answers = r1.body.paper.map(q => q.type === "mcq" ? 0 : "isolate and replace external dependencies with a mock using patch");
  const r2 = res(); await submit({ method: "POST", body: { token: r1.body.token, answers } }, r2);
  assert.strictEqual(r2.code, 200); assert.ok(r2.body.emailed);
  assert.ok(sent.body.subject.includes("Test Candidate"));
  const r3 = res(); await submit({ method: "POST", body: { token: r1.body.token.replace(/.$/, "x"), answers } }, r3);
  assert.strictEqual(r3.code, 400);
  console.log("OK  1000 papers valid, no answers leaked, tamper rejected");
  console.log("Email subject:", sent.body.subject);
})();
