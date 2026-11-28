// Encrypt or decrypt the question bank with TOKEN_SECRET (the same value the deployed app uses).
//   npm run bank:decrypt   lib/bank.enc -> lib/bank.source.js (git-ignored; edit this)
//   npm run bank:encrypt   lib/bank.source.js -> lib/bank.enc, then deletes the source (add -- --keep to keep it)
// TOKEN_SECRET comes from the environment, or from TOKEN_SECRET=... in a local .env file.
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (!process.env.TOKEN_SECRET && fs.existsSync(envFile)) {
  const m = fs.readFileSync(envFile, "utf8").match(/^\s*TOKEN_SECRET\s*=\s*"?([^"\r\n]*?)"?\s*$/m);
  if (m) process.env.TOKEN_SECRET = m[1];
}
const { encryptSource, decryptSource, compile, ENC_PATH, SRC_PATH } = require("../lib/bank-crypto");

const cmd = process.argv[2], keep = process.argv.includes("--keep");
try {
  if (cmd === "decrypt") {
    fs.writeFileSync(SRC_PATH, decryptSource(fs.readFileSync(ENC_PATH, "utf8")));
    console.log("Decrypted to lib/bank.source.js. Edit it, then run `npm run bank:encrypt`.");
  } else if (cmd === "encrypt") {
    const source = fs.readFileSync(SRC_PATH, "utf8");
    compile(source); // refuse to encrypt a bank that doesn't load
    const out = encryptSource(source);
    if (decryptSource(out) !== source) throw new Error("round-trip check failed");
    fs.writeFileSync(ENC_PATH, out);
    if (!keep) fs.unlinkSync(SRC_PATH);
    console.log("Encrypted to lib/bank.enc" + (keep ? "" : " and deleted lib/bank.source.js") + ". Commit lib/bank.enc.");
  } else {
    console.error("Usage: node scripts/bank.js decrypt|encrypt [--keep]"); process.exit(2);
  }
} catch (e) { console.error(e.message); process.exit(1); }
