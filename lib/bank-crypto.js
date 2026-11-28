// Encryption for the question bank. The bank (questions, answers, marking keys) is committed only as
// lib/bank.enc, sealed with AES-256-GCM using a key derived from TOKEN_SECRET. Without the secret nobody
// can read it, and any edit made without the secret fails the GCM authentication check, so the app
// refuses to load it.
const crypto = require("crypto");
const zlib = require("zlib");
const Module = require("module");
const path = require("path");

const PREFIX = "PDB1.";
const ENC_PATH = path.join(__dirname, "bank.enc");
const SOURCE_PATH = path.join(__dirname, "bank.source.js"); // plaintext, gitignored, local editing only

function secretFrom(s) {
  if (!s || s.length < 16) throw new Error("TOKEN_SECRET env var is missing or shorter than 16 characters");
  return s;
}
// Separate key from the result-file key ("receipt|…") and the token HMAC key.
const keyFor = (secret) => crypto.createHash("sha256").update("bank|" + secretFrom(secret)).digest();

function encrypt(sourceText, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(sourceText, "utf8"))), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64") + "\n";
}

function decrypt(encText, secret) {
  const s = String(encText || "").trim();
  if (!s.startsWith(PREFIX)) throw new Error("bank.enc is not a valid encrypted bank");
  const raw = Buffer.from(s.slice(PREFIX.length), "base64");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return zlib.gunzipSync(Buffer.concat([d.update(raw.subarray(28)), d.final()])).toString("utf8");
  } catch {
    throw new Error("Could not decrypt lib/bank.enc: wrong TOKEN_SECRET, or the file was modified");
  }
}

// Runs the decrypted bank source as a CommonJS module and returns its exports ({ MODULES, BANK }).
function load(sourceText, filename = path.join(__dirname, "bank.source.js")) {
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(sourceText, filename);
  return m.exports;
}

// What lib/bank.js runs: decrypt lib/bank.enc with TOKEN_SECRET and return { MODULES, BANK }.
function loadBank(secret = process.env.TOKEN_SECRET) {
  return load(decrypt(require("fs").readFileSync(ENC_PATH, "utf8"), secret));
}

module.exports = { encrypt, decrypt, load, loadBank, ENC_PATH, SOURCE_PATH, PREFIX };
