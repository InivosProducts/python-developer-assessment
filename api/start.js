// POST /api/start  { name }  ->  { token, paper, startedAt }
// The token is HMAC-signed and carries the candidate name, paper seed and server start time,
// so the duration and question set can't be changed by the browser.
const crypto = require("crypto");
const { buildPaper, publicPaper, sign } = require("../lib/paper");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(body.name || "").trim().slice(0, 100);
    if (name.length < 2) return res.status(400).json({ error: "Please enter your full name." });

    const seed = crypto.randomInt(100000, 1000000);
    const startedAt = Date.now();
    const token = sign({ name, seed, startedAt });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ token, startedAt, paper: publicPaper(buildPaper(seed)) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server is not configured correctly." });
  }
};
