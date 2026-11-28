#!/usr/bin/env node
// Question bank tool. Needs the same TOKEN_SECRET as the deployment.
//   TOKEN_SECRET=… npm run bank:decrypt   lib/bank.enc -> lib/bank.source.js (plaintext, gitignored)
//   TOKEN_SECRET=… npm run bank:encrypt   lib/bank.source.js -> lib/bank.enc (then delete the plaintext)
//   TOKEN_SECRET=… npm run bank:check     confirms lib/bank.enc decrypts and is a valid bank
//   TOKEN_SECRET=… node scripts/bank.js rekey NEW_SECRET   re-encrypts lib/bank.enc for a new TOKEN_SECRET
//   TOKEN_SECRET=… node scripts/bank.js migrate   one-time switch: encrypts the plaintext lib/bank.js into
//                                                 lib/bank.enc and replaces lib/bank.js with the loader
const fs = require("fs");
const path = require("path");
const { encrypt, decrypt, load, ENC_PATH, SOURCE_PATH } = require("../lib/bank-crypto");

const secret = process.env.TOKEN_SECRET;
const [cmd, arg] = process.argv.slice(2);

const LOADER = `// Loads the question bank from lib/bank.enc, decrypting it with TOKEN_SECRET.
// To edit the questions, see "Editing the question bank" in README.md (npm run bank:decrypt / bank:encrypt).
module.exports = require("./bank-crypto").loadBank();
`;

function validate(src) {
  const { MODULES, BANK } = load(src);
  if (!Array.isArray(MODULES) || !Array.isArray(BANK)) throw new Error("bank must export MODULES and BANK arrays");
  MODULES.forEach((name, m) => {
    const mcq = BANK.filter((q) => q.m === m && q.type === "mcq").length;
    const text = BANK.filter((q) => q.m === m && q.type === "text").length;
    if (mcq < 3 || text < 1) throw new Error(`module "${name}" needs at least 3 MCQ and 1 free-text question (has ${mcq}/${text})`);
  });
  return BANK;
}

try {
  if (cmd === "decrypt") {
    if (fs.existsSync(SOURCE_PATH) && arg !== "--force") throw new Error("lib/bank.source.js already exists; pass --force to overwrite it");
    fs.writeFileSync(SOURCE_PATH, decrypt(fs.readFileSync(ENC_PATH, "utf8"), secret));
    console.log("Wrote lib/bank.source.js (plaintext, gitignored). Edit it, then run: npm run bank:encrypt");
  } else if (cmd === "encrypt") {
    const src = fs.readFileSync(SOURCE_PATH, "utf8");
    const bank = validate(src);
    fs.writeFileSync(ENC_PATH, encrypt(src, secret));
    decrypt(fs.readFileSync(ENC_PATH, "utf8"), secret); // round-trip check
    console.log(`Encrypted ${bank.length} questions into lib/bank.enc. Delete lib/bank.source.js when you're done.`);
  } else if (cmd === "check") {
    const bank = validate(decrypt(fs.readFileSync(ENC_PATH, "utf8"), secret));
    console.log(`lib/bank.enc OK: ${bank.length} questions.`);
  } else if (cmd === "rekey") {
    if (!arg) throw new Error("usage: TOKEN_SECRET=old node scripts/bank.js rekey NEW_SECRET");
    const src = decrypt(fs.readFileSync(ENC_PATH, "utf8"), secret);
    fs.writeFileSync(ENC_PATH, encrypt(src, arg));
    console.log("Re-encrypted lib/bank.enc for the new TOKEN_SECRET.");
  } else if (cmd === "migrate") {
    const bankJs = path.join(__dirname, "../lib/bank.js");
    const src = fs.readFileSync(bankJs, "utf8");
    if (src.includes("loadBank")) throw new Error("lib/bank.js is already the encrypted-bank loader");
    const bank = validate(src);
    fs.writeFileSync(ENC_PATH, encrypt(src, secret));
    decrypt(fs.readFileSync(ENC_PATH, "utf8"), secret);
    fs.writeFileSync(bankJs, LOADER);
    console.log(`Encrypted ${bank.length} questions into lib/bank.enc and replaced lib/bank.js with the loader.`);
  } else {
    console.log("usage: node scripts/bank.js decrypt [--force] | encrypt | check | rekey NEW_SECRET | migrate");
    process.exitCode = 2;
  }
} catch (e) {
  console.error("Error: " + e.message);
  process.exitCode = 1;
}
