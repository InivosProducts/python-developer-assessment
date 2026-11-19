// POST /api/submit  { token, answers }  ->  grades on the server and emails the result via Mailgun.
const { buildPaper, verify, grade, MAX_DURATION_MS } = require("../lib/paper");
const { sendMailgun } = require("../lib/mail");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const stripTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + "h " : "") + m + "m " + sec + "s";
}

function buildEmail({ name, email, seed, startedAt, finishedAt, result }) {
  const duration = fmtDuration(finishedAt - startedAt);
  const tz = process.env.RESULTS_TIMEZONE || "Asia/Colombo";
  const when = (t) => new Date(t).toLocaleString("en-GB", { timeZone: tz }) + " (" + tz + ")";
  const subject = `Python Developer test: ${name}, ${result.total}/${result.max} (${result.percent}%) in ${duration}`;

  const modRows = Object.entries(result.byModule).map(([m, s]) => `${m}: ${s.points}/${s.max}`);
  const text = [
    `Candidate: ${name}`,
    `Email: ${email || "(not verified)"}`,
    `Score: ${result.total} / ${result.max} (${result.percent}%)`,
    `Duration: ${duration}`,
    `Started: ${when(startedAt)}`,
    `Finished: ${when(finishedAt)}`,
    `Paper version: ${seed}`,
    "",
    "By module:",
    ...modRows.map((r) => "- " + r),
    "",
    "Free-text answers (auto-scored; please review):",
    ...result.details.filter((d) => d.type === "text").flatMap((d) => [
      "",
      `Q${d.n} [${d.module}] ${stripTags(d.question)}`,
      `Answer: ${d.answer || "(no answer)"}`,
      `Auto-score: ${d.points}/2. Key points: ${d.keyPoints.map((k) => (k.hit ? "✓ " : "✗ ") + k.label).join(", ")}`,
      `Model answer: ${d.model}`,
    ]),
  ].join("\n");

  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:720px">
<h2 style="margin:0 0 12px">Python Developer Assessment result</h2>
<table>${row("Candidate", name)}${row("Email", email ? email + " (verified)" : "(not verified)")}${row("Score", `${result.total} / ${result.max} (${result.percent}%)`)}${row("Duration", duration)}${row("Started", when(startedAt))}${row("Finished", when(finishedAt))}${row("Paper version", seed)}</table>
<h3 style="margin:20px 0 6px">By module</h3>
<table style="border-collapse:collapse">${Object.entries(result.byModule).map(([m, s]) => `<tr><td style="padding:3px 16px 3px 0;border-bottom:1px solid #eee">${esc(m)}</td><td style="padding:3px 0;border-bottom:1px solid #eee">${s.points} / ${s.max}</td></tr>`).join("")}</table>
<h3 style="margin:20px 0 6px">All questions</h3>
${result.details.map((d) => `<div style="border:1px solid #e5e5e5;border-radius:8px;padding:10px 12px;margin:0 0 8px">
<div style="color:#666;font-size:12px">Q${d.n} · ${esc(d.module)} · ${d.type === "mcq" ? "Multiple choice" : "Free text"} · <b style="color:${d.points === d.max ? "#1f7a4d" : d.points > 0 ? "#9a6700" : "#b3261e"}">${d.points}/${d.max}</b></div>
<div style="margin:4px 0">${esc(stripTags(d.question))}</div>
${d.type === "mcq"
  ? `<div>Chosen: ${esc(d.chosen ?? "(no answer)")}<br>Correct: ${esc(d.correct)}</div>`
  : `<div style="background:#f7f7f5;padding:8px;border-radius:6px;white-space:pre-wrap">${esc(d.answer || "(no answer)")}</div>
<div style="font-size:12px;margin-top:4px">Key points: ${d.keyPoints.map((k) => (k.hit ? "✓ " : "✗ ") + esc(k.label)).join(", ")}</div>
<div style="font-size:12px;color:#555;margin-top:4px"><i>Model answer:</i> ${esc(d.model)}</div>`}
</div>`).join("")}
<p style="color:#888;font-size:12px">Free-text scores are automatic (keyword-based) and should be checked by a marker.</p></div>`;
  return { subject, text, html };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const t = verify(body.token);
    if (!t || t.typ === "otp" || !Number.isInteger(t.seed)) return res.status(400).json({ error: "Invalid or tampered test session." });
    const finishedAt = Date.now();
    if (finishedAt - t.startedAt > MAX_DURATION_MS) return res.status(400).json({ error: "This test session has expired." });

    const result = grade(buildPaper(t.seed), body.answers);
    const msg = buildEmail({ name: t.name, email: t.email, seed: t.seed, startedAt: t.startedAt, finishedAt, result });
    let emailed = true;
    try { await sendMailgun({ ...msg, to: process.env.RESULTS_TO, replyTo: t.email || undefined }); } catch (e) {
      // Keep the result recoverable from the Vercel function logs if the email fails.
      console.error("EMAIL FAILED", e.message, "\n" + msg.text);
      emailed = false;
    }

    const showScore = (process.env.SHOW_SCORE_TO_CANDIDATE || "true").toLowerCase() !== "false";
    return res.status(200).json({
      emailed,
      duration: fmtDuration(finishedAt - t.startedAt),
      ...(showScore ? { total: result.total, max: result.max, percent: result.percent } : {}),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not submit the test. Please tell the test administrator." });
  }
};
