// Stateless email verification (no database).
// /api/verify-email emails a 6-digit code and returns a signed "challenge" token that holds the
// name, email, expiry and an HMAC of the code. /api/start checks the code against that HMAC.
// The code itself never leaves the server except in the email, and the challenge can't be
// edited or reused for another address because it is signed with TOKEN_SECRET.
const crypto = require("crypto");
const { sign, verify, secret } = require("./paper");

const CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@"<>(),;:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function isEnabled() {
  return (process.env.EMAIL_VERIFICATION || "on").toLowerCase() !== "off";
}

function normaliseEmail(s) {
  const email = String(s || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function codeMac(email, code, exp) {
  return crypto.createHmac("sha256", secret()).update(`otp|${email}|${code}|${exp}`).digest("base64url");
}

function createChallenge(name, email) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const exp = Date.now() + CODE_TTL_MS;
  const challenge = sign({ typ: "otp", name, email, exp, h: codeMac(email, code, exp) });
  return { code, challenge, exp };
}

// Returns { name, email } when the code matches, otherwise { error }.
function checkChallenge(challenge, code) {
  const c = verify(challenge);
  if (!c || c.typ !== "otp") return { error: "Your verification session is invalid. Please request a new code." };
  if (Date.now() > c.exp) return { error: "This code has expired. Please request a new one." };
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== 6) return { error: "Please enter the 6-digit code from the email." };
  const a = Buffer.from(codeMac(c.email, clean, c.exp)), b = Buffer.from(String(c.h));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: "That code is not correct. Please check the email and try again." };
  return { name: c.name, email: c.email };
}

module.exports = { isEnabled, normaliseEmail, createChallenge, checkChallenge, CODE_TTL_MS };
