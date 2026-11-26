// POST /api/admin  { password, receipt, action: "view" | "resend" }
// Opens a candidate's encrypted result file for the hiring team (used by /admin.html).
//   view   -> { name, email, total, max, percent, submittedAt, subject, html }
//   resend -> emails the result to RESULTS_TO again and returns { sent: true, id }
// Turned off unless the ADMIN_PASSWORD environment variable is set (at least 8 characters).
const crypto = require("crypto");
const receipt = require("../lib/receipt");
const { buildEmail } = require("../lib/report");
const { sendWithRetry } = require("../lib/mail");

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const expected = process.env.ADMIN_PASSWORD || "";
    if (expected.length < 8) return res.status(503).json({ error: "The admin page is turned off. Set ADMIN_PASSWORD (8+ characters) in Vercel and redeploy." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!crypto.timingSafeEqual(digest(body.password || ""), digest(expected))) {
      console.warn("ADMIN LOGIN FAILED");
      await new Promise((r) => setTimeout(r, 1000)); // slows down password guessing
      return res.status(401).json({ error: "Wrong password." });
    }

    const r = receipt.open(body.receipt);
    if (!r) return res.status(400).json({ error: "This isn't a valid result file. It may be incomplete, edited, or from a deployment with a different TOKEN_SECRET." });
    const msg = buildEmail(r);
    const who = `name="${r.name}" email=${r.email || "-"} score=${r.result.total}/${r.result.max} paper=${r.seed}`;

    if (body.action === "resend") {
      const id = await sendWithRetry({ ...msg, subject: "[Resent] " + msg.subject, to: process.env.RESULTS_TO, replyTo: r.email || undefined })
        .catch((e) => { console.error(`ADMIN RESEND FAILED ${who} error=${e.message}`); throw Object.assign(e, { userMessage: "Mailgun rejected the email: " + e.message }); });
      console.log(`ADMIN RESEND ${who} mailgun_id=${id}`);
      return res.status(200).json({ sent: true, id });
    }

    console.log(`ADMIN VIEW ${who}`);
    return res.status(200).json({
      name: r.name, email: r.email, total: r.result.total, max: r.result.max, percent: r.result.percent,
      startedAt: r.startedAt, submittedAt: r.finishedAt, subject: msg.subject, html: msg.html,
    });
  } catch (e) {
    if (e.userMessage) return res.status(502).json({ error: e.userMessage });
    console.error("ADMIN ERROR", e);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
};
