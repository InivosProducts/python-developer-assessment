// POST /api/verify-email  { name, email, skipTypoCheck? }  ->  { challenge, expiresAt, email }
// Checks the address can receive mail (lib/email-check.js), then emails a 6-digit code to the candidate.
// If the check fails: 400 { error, reason: "typo" | "domain" | "mailbox", suggestion? }. The returned challenge token is passed back to
// /api/start together with the code. No database is used.
const { isEnabled, normaliseEmail, createChallenge, CODE_TTL_MS } = require("../lib/verify-email");
const { sendMailgun } = require("../lib/mail");
const { checkEmail } = require("../lib/email-check");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!isEnabled()) return res.status(400).json({ error: "Email verification is turned off." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(body.name || "").trim().slice(0, 100);
    if (name.length < 2) return res.status(400).json({ error: "Please enter your full name." });
    const email = normaliseEmail(body.email);
    if (!email) return res.status(400).json({ error: "Please enter a valid email address." });

    const check = await checkEmail(email, { skipTypoCheck: body.skipTypoCheck === true });
    if (!check.ok) return res.status(400).json({ error: check.error, reason: check.reason, suggestion: check.suggestion });

    const { code, challenge, exp } = createChallenge(name, email);
    const mins = Math.round(CODE_TTL_MS / 60000);
    try {
      await sendMailgun({
        to: email,
        subject: `Your Python Developer Assessment code: ${code}`,
        text: `Hi ${name},\n\nYour verification code is ${code}\n\nEnter it on the assessment page to start the test. The code expires in ${mins} minutes.\n\nIf you didn't request this, you can ignore this email.`,
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#222">
<p>Hi ${esc(name)},</p><p>Your verification code is</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>
<p>Enter it on the assessment page to start the test. The code expires in ${mins} minutes.</p>
<p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p></div>`,
      });
    } catch (e) {
      console.error("VERIFICATION EMAIL FAILED", email, e.message);
      return res.status(502).json({ error: "We couldn't send a code to that address. Please check it, or contact the test administrator." });
    }
    return res.status(200).json({ challenge, expiresAt: exp, email });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server is not configured correctly." });
  }
};
