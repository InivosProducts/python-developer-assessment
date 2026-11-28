// Local check: builds many papers, verifies the mix, and runs a full start -> submit cycle with Mailgun stubbed.
// The question bank is encrypted with TOKEN_SECRET, so the test needs the deployment's real secret.
if (!process.env.TOKEN_SECRET) { console.error("Set TOKEN_SECRET (the deployment's value) to run the tests: TOKEN_SECRET=... npm test"); process.exit(1); }
process.env.MAILGUN_API_KEY = "x"; process.env.MAILGUN_DOMAIN = "example.mailgun.org"; process.env.RESULTS_TO = "test@example.com";
const assert = require("assert");

// Encrypted bank: round trip, wrong secret and tampering are rejected.
{
  const bc = require("../lib/bank-crypto");
  const enc = bc.encrypt("module.exports = { x: /a+/ };", "bank-test-secret-1234567890");
  assert.ok(bc.load(bc.decrypt(enc, "bank-test-secret-1234567890")).x.test("aa"));
  assert.throws(() => bc.decrypt(enc, "another-secret-1234567890"), /wrong TOKEN_SECRET/);
  const raw = Buffer.from(enc.trim().slice(bc.PREFIX.length), "base64"); raw[raw.length - 1] ^= 1;
  assert.throws(() => bc.decrypt(bc.PREFIX + raw.toString("base64"), "bank-test-secret-1234567890"), /modified/);
  assert.throws(() => bc.decrypt(enc, "short"), /TOKEN_SECRET/);
}
const { buildPaper, publicPaper, MODULES } = require("../lib/paper");
let sent = null, mgValidate = null, mgSend = [], sendCalls = 0;
global.fetch = async (url, opts = {}) => {
  if (url.includes("/address/validate")) {
    const addr = new URL(url).searchParams.get("address");
    if (mgValidate === "down") return { ok: false, status: 402, text: async () => "payment required" };
    return { ok: true, json: async () => ({ address: addr, result: addr.startsWith("nobody@") ? "undeliverable" : "deliverable", did_you_mean: addr.startsWith("nobody@") ? "somebody@example.com" : undefined }) };
  }
  sendCalls++;
  const fail = mgSend.shift(); // queue of failures to simulate: a status code or "network"
  if (fail === "network") throw new Error("fetch failed");
  if (fail) return { ok: false, status: fail, text: async () => "simulated failure" };
  sent = { url, body: Object.fromEntries(new URLSearchParams(opts.body)) }; return { ok: true, text: async () => JSON.stringify({ id: "<test-id@mailgun>", message: "Queued" }) };
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

  // Result recovery without a database: every submission returns an encrypted result file.
  const receipt = require("../lib/receipt"), admin = require("../api/admin");
  const submitFresh = async (failures = []) => {
    const v2 = res(); await verifyEmail({ method: "POST", body: { name: "Recovery Test", email: "rec@example.com" } }, v2);
    const c2 = sent.body.subject.match(/(\d{6})$/)[1];
    const s2 = res(); await start({ method: "POST", body: { challenge: v2.body.challenge, code: c2 } }, s2);
    mgSend = failures; sendCalls = 0;
    const r = res(); await submit({ method: "POST", body: { token: s2.body.token, answers } }, r); return r;
  };
  let sr = await submitFresh();
  assert.ok(sr.body.emailed && /^PDA1\./.test(sr.body.receipt));
  assert.ok(!/Recovery Test|rec@example|"correct"/.test(Buffer.from(sr.body.receipt.slice(5), "base64url").toString("latin1")), "result file must be encrypted");
  const opened = receipt.open("Some header text\n\n" + sr.body.receipt + "\n");
  assert.strictEqual(opened.name, "Recovery Test"); assert.strictEqual(opened.email, "rec@example.com"); assert.strictEqual(opened.result.details.length, 20);
  const bad1 = sr.body.receipt.slice(0, 40) + (sr.body.receipt[40] === "A" ? "B" : "A") + sr.body.receipt.slice(41);
  assert.strictEqual(receipt.open(bad1), null, "edited result file rejected");
  // Mailgun hiccups are retried; configuration errors are not.
  sr = await submitFresh([503, "network"]);
  assert.ok(sr.body.emailed, "retried after transient failures"); assert.strictEqual(sendCalls, 3);
  sr = await submitFresh([401]);
  assert.strictEqual(sr.body.emailed, false); assert.strictEqual(sendCalls, 1, "no retry on 401"); assert.ok(/^PDA1\./.test(sr.body.receipt));
  mgSend = [];
  // Admin viewer.
  const adm = async (body) => { const r = res(); await admin({ method: "POST", body }, r); return r; };
  assert.strictEqual((await adm({ password: "x", receipt: sr.body.receipt })).code, 503, "off without ADMIN_PASSWORD");
  process.env.ADMIN_PASSWORD = "correct-horse-battery";
  assert.strictEqual((await adm({ password: "wrong-password", receipt: sr.body.receipt })).code, 401);
  assert.strictEqual((await adm({ password: "correct-horse-battery", receipt: bad1 })).code, 400);
  const view = await adm({ password: "correct-horse-battery", receipt: "pasted from logs RESULT FILE: " + sr.body.receipt, action: "view" });
  assert.strictEqual(view.code, 200); assert.strictEqual(view.body.name, "Recovery Test"); assert.ok(view.body.html.includes("Recovery Test"));
  sent = null; const rs = await adm({ password: "correct-horse-battery", receipt: sr.body.receipt, action: "resend" });
  assert.strictEqual(rs.code, 200); assert.ok(sent.body.subject.startsWith("[Resent] ")); assert.strictEqual(sent.body.to, "test@example.com");
  mgSend = [401]; const rf = await adm({ password: "correct-horse-battery", receipt: sr.body.receipt, action: "resend" });
  assert.strictEqual(rf.code, 502); mgSend = [];
  process.env.TOKEN_SECRET = "a-different-secret-0987654321";
  assert.strictEqual(receipt.open(sr.body.receipt), null, "other deployments can't open it");
  process.env.TOKEN_SECRET = "local-test-secret-1234567890";
  delete process.env.ADMIN_PASSWORD;

  console.log("OK  1000 papers valid, no answers leaked, email verification enforced, email existence checks, tamper rejected, result recovery");
  console.log("Email subject:", sent.body.subject);
})().catch(e => { console.error(e); process.exit(1); });
