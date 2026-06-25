const db = require('../utils/db');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. Please login first using your Web3 wallet.' });
    }

    const token = authHeader.split(' ')[1];
    
    // Find session in DB
    const sessionResult = await db.query(
      `SELECT s.token, u.id as user_id, u.wallet_address, u.username, u.integrity_score, u.is_mock 
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
      [token]
    );
    const session = sessionResult.rows[0];

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

