// GET /api/config  ->  public settings the candidate page needs before the test starts.
const { isEnabled } = require("../lib/verify-email");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ emailVerification: isEnabled() });
};
