// POST /api/start  { name }                       (when EMAIL_VERIFICATION=off)
// POST /api/start  { challenge, code }            (default: email verified first via /api/verify-email)
//   ->  { token, paper, startedAt, name, email }
// The token is HMAC-signed and carries the candidate name, verified email, paper seed and
// server start time, so none of them can be changed by the browser.
const crypto = require("crypto");
const { buildPaper, publicPaper, sign } = require("../lib/paper");
const { isEnabled, checkChallenge } = require("../lib/verify-email");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    let name, email = null;
    if (isEnabled()) {
      const v = checkChallenge(body.challenge, body.code);
      if (v.error) return res.status(400).json({ error: v.error });
      ({ name, email } = v);
    } else {
      name = String(body.name || "").trim().slice(0, 100);
      if (name.length < 2) return res.status(400).json({ error: "Please enter your full name." });
    }

    const seed = crypto.randomInt(100000, 1000000);
    const startedAt = Date.now();
    const token = sign({ typ: "test", name, email, seed, startedAt });
    return res.status(200).json({ token, startedAt, name, email, paper: publicPaper(buildPaper(seed)) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server is not configured correctly." });
  }
};
