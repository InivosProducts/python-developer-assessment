// Encrypted result files ("receipts"): a way to recover a candidate's result without a database.
// /api/submit seals the full graded result with AES-256-GCM (key derived from TOKEN_SECRET) and
// hands it to the candidate's browser to download. Only the server can open it, so the candidate
// can't read the answers or change their score. /api/admin opens it for the hiring team.
const crypto = require("crypto");
const zlib = require("zlib");
const { secret } = require("./paper");

const PREFIX = "PDA1.";
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const key = () => crypto.createHash("sha256").update("receipt|" + secret()).digest();

function seal(data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(data))), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

// Accepts the bare token or any text containing it (the downloaded file, a pasted email...).
// Returns the data, or null if it is missing, damaged, tampered with or sealed with another secret.
function open(text) {
  const m = String(text || "").match(/PDA1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const raw = Buffer.from(m[1], "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const zipped = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    return JSON.parse(zlib.gunzipSync(zipped, { maxOutputLength: MAX_JSON_BYTES }).toString());
  } catch { return null; }
}

module.exports = { seal, open };
