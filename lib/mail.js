// Minimal Mailgun sender shared by the API routes (no npm dependencies).
const ATTEMPT_TIMEOUT_MS = 10000;

// Sends one message. Returns Mailgun's message id (useful for finding it in Mailgun's logs).
async function sendMailgun({ to, subject, text, html, replyTo }) {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!key || !domain || !to) throw new Error("MAILGUN_API_KEY, MAILGUN_DOMAIN and a recipient must be set");
  const host = (process.env.MAILGUN_REGION || "us").toLowerCase() === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  const form = new URLSearchParams({
    from: process.env.RESULTS_FROM || `Python Assessment <postmaster@${domain}>`,
    to, subject, text, html,
  });
  if (replyTo) form.set("h:Reply-To", replyTo);
  const r = await fetch(`https://${host}/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from("api:" + key).toString("base64") },
    body: form,
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Mailgun ${r.status}: ${body.slice(0, 300)}`), { status: r.status });
  try { return JSON.parse(body).id || "(no id)"; } catch { return "(no id)"; }
}

// Retries network errors, timeouts, rate limits and Mailgun server errors. Configuration errors
// (wrong key, wrong domain or region, unauthorised recipient) fail at once: retrying can't fix them.
async function sendWithRetry(msg, attempts = 3) {
  for (let i = 1; ; i++) {
    try { return await sendMailgun(msg); }
    catch (e) {
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || i >= attempts) { e.attempts = i; throw e; }
      console.warn(`EMAIL RETRY attempt=${i} error=${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

module.exports = { sendMailgun, sendWithRetry };
