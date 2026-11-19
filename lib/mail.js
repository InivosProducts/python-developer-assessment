// Minimal Mailgun sender shared by the API routes (no npm dependencies).
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
  });
  if (!r.ok) throw new Error(`Mailgun ${r.status}: ${await r.text()}`);
}

module.exports = { sendMailgun };
