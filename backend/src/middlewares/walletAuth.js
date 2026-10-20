const sessionService = require('../services/sessionService');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. Please login first using your Web3 wallet.' });
    }

    const token = authHeader.split(' ')[1];

    const session = await sessionService.findSession(token);

    if (!session) {
      return res.status(401).json({ error: 'Your login session is invalid or has expired. Please login again.' });
    }

    // Attach user/session details to the request object
    req.user = {
      userId: session.user_id,
      walletAddress: session.wallet_address,
      username: session.username,
      integrityScore: session.integrity_score,
      isMock: session.is_mock
    };
    next();
  } catch (err) {
    console.error('[walletAuth Middleware] Error:', err);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
};

