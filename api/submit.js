// POST /api/submit  { token, answers }  ->  grades on the server, emails the result via Mailgun and
// returns an encrypted result file (receipt) the candidate can download. If the email never arrives,
// the hiring team can open that file at /admin.html. See lib/receipt.js.
const { buildPaper, verify, grade, MAX_DURATION_MS } = require("../lib/paper");
const { sendWithRetry } = require("../lib/mail");
const { buildEmail, fmtDuration } = require("../lib/report");
const receipt = require("../lib/receipt");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const t = verify(body.token);
    if (!t || t.typ === "otp" || !Number.isInteger(t.seed)) return res.status(400).json({ error: "Invalid or tampered test session." });
    const finishedAt = Date.now();
    if (finishedAt - t.startedAt > MAX_DURATION_MS) return res.status(400).json({ error: "This test session has expired." });

    const result = grade(buildPaper(t.seed), body.answers);
    const record = { v: 1, name: t.name, email: t.email || null, seed: t.seed, startedAt: t.startedAt, finishedAt, result };
    const sealed = receipt.seal(record);
    const msg = buildEmail(record);
    const who = `name="${t.name}" email=${t.email || "-"} score=${result.total}/${result.max} paper=${t.seed}`;
    console.log(`SUBMIT RECEIVED ${who}`);

    let emailed = false;
    try {
      const id = await sendWithRetry({ ...msg, to: process.env.RESULTS_TO, replyTo: t.email || undefined });
      console.log(`RESULT EMAILED ${who} mailgun_id=${id}`);
      emailed = true;
    } catch (e) {
      // Keep the result recoverable: the full text and the encrypted result file go to the logs.
      console.error(`EMAIL FAILED ${who} attempts=${e.attempts || 1} error=${e.message}\n${msg.text}\nRESULT FILE: ${sealed}`);
    }

    const showScore = (process.env.SHOW_SCORE_TO_CANDIDATE || "true").toLowerCase() !== "false";
    return res.status(200).json({
      emailed,
      duration: fmtDuration(finishedAt - t.startedAt),
      receipt: sealed,
      ...(showScore ? { total: result.total, max: result.max, percent: result.percent } : {}),
    });
  } catch (e) {
    console.error("SUBMIT ERROR", e);
    return res.status(500).json({ error: "Could not submit the test. Please tell the test administrator." });
  }
};
