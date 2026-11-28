// Loads the question bank from lib/bank.enc, decrypting it with TOKEN_SECRET.
// To edit the questions, see "Editing the question bank" in README.md (npm run bank:decrypt / bank:encrypt).
module.exports = require("./bank-crypto").loadBank();
