// Encryption for the question bank file (lib/bank.enc): AES-256-GCM with a key derived from
// TOKEN_SECRET. GCM authentication means the file can't be read or changed without the secret.
// The payload is the gzipped JavaScript source of the bank module (it holds RegExp keys, which JSON can't).
const crypto = require("crypto");
const path = require("path");
const zlib = require("zlib");
const Module = require("module");

const PREFIX = "PDB1.";
const ENC_PATH = path.join(__dirname, "bank.enc");
const SRC_PATH = path.join(__dirname, "bank.source.js");
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

function bankSecret(s = process.env.TOKEN_SECRET) {
  if (!s || s.length < 16) throw new Error("TOKEN_SECRET env var is missing or shorter than 16 characters (it is needed to decrypt the question bank)");
  return s;
}
const keyFor = (secret) => crypto.createHash("sha256").update("bank|" + bankSecret(secret)).digest();

function encryptSource(source, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(source, "utf8"))), c.final()]);
  return "# Encrypted question bank. Edit with `npm run bank:decrypt` / `npm run bank:encrypt` (needs TOKEN_SECRET).\n" +
    PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url") + "\n";
}

function decryptSource(text, secret) {
  const m = String(text || "").match(/PDB1\.([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("lib/bank.enc is not an encrypted question bank");
  const key = keyFor(secret);
  try {
    const raw = Buffer.from(m[1], "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const zipped = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    return zlib.gunzipSync(zipped, { maxOutputLength: MAX_SOURCE_BYTES }).toString("utf8");
  } catch {
    throw new Error("Could not decrypt lib/bank.enc: wrong TOKEN_SECRET, or the file was modified");
  }
}

// Runs decrypted bank source as a CommonJS module and returns its exports.
function compile(source, filename = SRC_PATH) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  const exp = mod.exports;
  if (!exp || !Array.isArray(exp.MODULES) || !Array.isArray(exp.BANK) || !exp.BANK.length) throw new Error("question bank must export { MODULES, BANK }");
  return exp;
}

module.exports = { encryptSource, decryptSource, compile, ENC_PATH, SRC_PATH };
