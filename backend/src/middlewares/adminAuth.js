/**
 * Admin gate: only wallets listed in the ADMIN_WALLETS env var may act.
 * Fail-closed — an unset/empty list grants NOTHING (mirrors the
 * blockchain-mode philosophy: missing config is a denial, not a default-on).
 *
 * Must run AFTER walletAuth (which populates req.user.walletAddress).
 */

function isAdminWallet(walletAddress) {
  const admins = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0 || !walletAddress) return false;
  return admins.includes(String(walletAddress).trim().toLowerCase());
}

function adminAuth(req, res, next) {
  if (!isAdminWallet(req.user && req.user.walletAddress)) {
    return res.status(403).json({ error: 'Admin privileges required for this operation.' });
  }
  next();
}

module.exports = adminAuth;
module.exports.isAdminWallet = isAdminWallet;
