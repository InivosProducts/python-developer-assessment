// Checks that an email address can plausibly receive mail BEFORE a verification code is sent.
// No database. Three layers, cheapest first:
//   1. Typo check     - "gmial.com", "gmail.con" etc. Soft: the candidate can keep what they typed.
//   2. Domain check   - DNS lookup: the domain must exist and accept mail (MX, or A/AAAA fallback).
//   3. Mailbox check  - optional Mailgun Email Validation API (MAILGUN_VALIDATION=on).
// Network failures in layers 2 and 3 "fail open" so a DNS or Mailgun outage never blocks candidates;
// the 6-digit code is still the final proof that the address is real and theirs.
const dns = require("dns");

const DNS_TIMEOUT_MS = 3000;
const MAILGUN_TIMEOUT_MS = 5000;

// Real providers. Addresses at these domains are never flagged as typos.
const KNOWN_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.co.in",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "gmx.net", "mail.com",
  "protonmail.com", "proton.me", "pm.me", "zoho.com", "yandex.com", "inivosglobal.com",
];
// Only these are offered as corrections (the common targets of typos).
const SUGGEST_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com", "protonmail.com"];
const TLD_FIXES = { con: "com", cmo: "com", ocm: "com", vom: "com", xom: "com", comm: "com", coom: "com", cpm: "com", om: "com", cm: "com", ent: "net", nte: "net", rog: "org", ogr: "org" };

function isEnabled(name, dflt) {
  return (process.env[name] || dflt).toLowerCase() !== "off";
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity);
  return d[a.length][b.length];
}

// Returns a corrected domain, or null if the domain looks fine.
function suggestDomain(domain) {
  if (KNOWN_DOMAINS.includes(domain)) return null;
  let best = null, bestD = Infinity;
  for (const k of SUGGEST_DOMAINS) {
    const dd = distance(domain, k);
    if (dd < bestD) { best = k; bestD = dd; }
  }
  if (bestD <= (best.length >= 9 ? 2 : 1)) return best;
  const i = domain.lastIndexOf("."), tld = domain.slice(i + 1);
  if (TLD_FIXES[tld]) return domain.slice(0, i + 1) + TLD_FIXES[tld];
  return null;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms).unref?.())]);
}

// Swappable for tests.
const resolver = {
  resolveMx: (d) => dns.promises.resolveMx(d),
  resolve4: (d) => dns.promises.resolve4(d),
  resolve6: (d) => dns.promises.resolve6(d),
};

const NO_DOMAIN = new Set(["ENOTFOUND", "NXDOMAIN"]);
const NO_RECORDS = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);

// Before calling a domain non-existent, make sure DNS itself works, so a broken resolver on the
// server can never block every candidate.
async function dnsWorks() {
  try { return (await withTimeout(resolver.resolveMx("gmail.com"), DNS_TIMEOUT_MS)).length > 0; } catch { return false; }
}

// "ok" | "no-domain" | "no-mail" | "unknown"
async function checkDomain(domain) {
  try {
    const mx = await withTimeout(resolver.resolveMx(domain), DNS_TIMEOUT_MS);
    const real = (mx || []).filter((r) => r.exchange && r.exchange !== ".");
    return real.length ? "ok" : "no-mail"; // only a "null MX" (RFC 7505) means the domain refuses mail
  } catch (e) {
    if (NO_DOMAIN.has(e.code)) return (await dnsWorks()) ? "no-domain" : "unknown";
    if (e.code !== "ENODATA") return "unknown";
  }
  // No MX records: mail falls back to the domain's own address (RFC 5321 section 5.1).
  for (const fn of [resolver.resolve4, resolver.resolve6]) {
    try { if ((await withTimeout(fn(domain), DNS_TIMEOUT_MS)).length) return "ok"; }
    catch (e) { if (!NO_RECORDS.has(e.code)) return "unknown"; }
  }
  return "no-mail";
}

// Mailgun Email Validation. Returns { result, suggestion } or null if unavailable.
async function mailgunValidate(email) {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) return null;
  const host = (process.env.MAILGUN_REGION || "us").toLowerCase() === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  try {
    const r = await fetch(`https://${host}/v4/address/validate?address=${encodeURIComponent(email)}`, {
      headers: { Authorization: "Basic " + Buffer.from("api:" + key).toString("base64") },
      signal: AbortSignal.timeout(MAILGUN_TIMEOUT_MS),
    });
    if (!r.ok) { console.warn("MAILGUN VALIDATION UNAVAILABLE", r.status, (await r.text()).slice(0, 200)); return null; }
    const j = await r.json();
    return { result: j.result, suggestion: j.did_you_mean || null };
  } catch (e) {
    console.warn("MAILGUN VALIDATION UNAVAILABLE", e.message);
    return null;
  }
}

// email must already be normalised (trimmed, lower-case, valid format).
// Returns { ok: true } or { ok: false, reason, error, suggestion? }.
async function checkEmail(email, { skipTypoCheck = false } = {}) {
  const [local, domain] = [email.slice(0, email.lastIndexOf("@")), email.slice(email.lastIndexOf("@") + 1)];

  if (!skipTypoCheck) {
    const fix = suggestDomain(domain);
    if (fix) return { ok: false, reason: "typo", suggestion: `${local}@${fix}`, error: `Did you mean ${local}@${fix}?` };
  }

  if (isEnabled("EMAIL_DOMAIN_CHECK", "on")) {
    const d = await checkDomain(domain);
    if (d === "no-domain") return { ok: false, reason: "domain", error: `The domain "${domain}" doesn't exist. Please check your email address.` };
    if (d === "no-mail") return { ok: false, reason: "domain", error: `"${domain}" can't receive email. Please check your email address.` };
    if (d === "unknown") console.warn("DOMAIN CHECK INCONCLUSIVE", domain);
  }

  if (isEnabled("MAILGUN_VALIDATION", "off")) {
    const v = await mailgunValidate(email);
    if (v && (v.result === "undeliverable" || v.result === "do_not_send")) {
      const s = v.suggestion && v.suggestion !== email ? v.suggestion : null;
      return { ok: false, reason: "mailbox", suggestion: s || undefined,
        error: "This email address doesn't appear to exist." + (s ? ` Did you mean ${s}?` : " Please check it.") };
    }
  }
  return { ok: true };
}

module.exports = { checkEmail, checkDomain, suggestDomain, resolver };
