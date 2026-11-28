// Loads the question bank from lib/bank.enc, which is encrypted with a key derived from TOKEN_SECRET
// (see lib/bank-crypto.js), so the repository doesn't reveal the questions, answers or marking keys,
// and an edited file is rejected. To change questions:
//   npm run bank:decrypt   -> writes lib/bank.source.js (git-ignored); edit it
//   npm run bank:encrypt   -> writes lib/bank.enc and deletes lib/bank.source.js
const fs = require("fs");
const { decryptSource, compile, ENC_PATH, SRC_PATH } = require("./bank-crypto");

function load() {
  if (fs.existsSync(ENC_PATH)) return compile(decryptSource(fs.readFileSync(ENC_PATH, "utf8")));
  if (fs.existsSync(SRC_PATH)) {
    console.warn("WARNING question bank is NOT encrypted (lib/bank.enc missing). Run `npm run bank:encrypt`.");
    return compile(fs.readFileSync(SRC_PATH, "utf8"));
  }
  throw new Error("Question bank missing: lib/bank.enc not found");
}

const { MODULES, BANK } = load();
module.exports = { MODULES, BANK };
