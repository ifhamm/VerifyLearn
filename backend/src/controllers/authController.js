const { ethers } = require('ethers');
const crypto = require('crypto');
const db = require('../utils/db');

// Verify message signature and establish session
exports.login = async (req, res) => {
  try {
    const { address, signature, message, username, isMock } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Wallet address is required.' });
    }

    let isValid = false;

    if (isMock) {
      // Allow mock login for local testing
      if (signature === 'mock-signature') {
        isValid = true;
      } else {
        return res.status(400).json({ error: 'Invalid mock signature.' });
      }
    } else {
      if (!signature || !message) {
        return res.status(400).json({ error: 'Signature and message are required for real Web3 login.' });
      }

      try {
        // Recover address from message and signature
        const recoveredAddress = ethers.verifyMessage(message, signature);
        
        if (recoveredAddress.toLowerCase() === address.toLowerCase()) {
          isValid = true;
        } else {
          return res.status(401).json({ error: 'Signature verification failed. Address mismatch.' });
        }
      } catch (err) {
        console.error('Ethers verifyMessage error:', err);
        return res.status(400).json({ error: 'Failed to verify cryptographic signature: ' + err.message });
      }
    }

    if (isValid) {
      const userAddress = address.toLowerCase();
      const finalUsername = username || `${address.slice(0, 6)}...${address.slice(-4)}`;

      // Upsert User in PostgreSQL
      const userResult = await db.query(
        `INSERT INTO users (wallet_address, username, is_mock) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (wallet_address) 
         DO UPDATE SET username = COALESCE($2, users.username), is_mock = $3
         RETURNING *`,
        [userAddress, finalUsername, !!isMock]
      );
      
      const user = userResult.rows[0];

      // Fetch user's existing learning plan if any
      const planResult = await db.query(
        `SELECT plan_data FROM user_learning_paths WHERE user_id = $1`,
        [user.id]
      );
      const learningPlan = planResult.rows[0] ? planResult.rows[0].plan_data : null;

      // Fetch user's existing completed slugs
      const progressResult = await db.query(
        `SELECT material_slug FROM user_progress WHERE user_id = $1 AND status = 'completed'`,
        [user.id]
      );
      const completedSlugs = progressResult.rows.map(row => row.material_slug);

      // Create session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // Token expires in 24 hours
      
      // Save session in database
      await db.query(
        `INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
        [sessionToken, user.id, expiresAt]
      );

      console.log(`[authController] User login successful. Address: ${userAddress}, Username: ${user.username}, SessionToken: ${sessionToken.slice(0, 8)}...`);

      return res.json({
        success: true,
        message: 'Authenticated successfully',
        token: sessionToken,
        walletAddress: userAddress,
        username: user.username,
        integrityScore: user.integrity_score,
        learningPlan,
        completedSlugs
      });
    }

    return res.status(401).json({ error: 'Authentication failed.' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Check if a session token is active and valid
exports.checkSession = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ isAuthenticated: false, error: 'No active session token found.' });
    }

    const token = authHeader.split(' ')[1];
    
    // Find active session in DB
    const sessionResult = await db.query(
      `SELECT s.token, u.id as user_id, u.wallet_address, u.username, u.integrity_score, u.is_mock 
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
      [token]
    );
    const session = sessionResult.rows[0];

    if (!session) {
      return res.status(401).json({ isAuthenticated: false, error: 'Session has expired or is invalid.' });
    }

    // Fetch learning plan
    const planResult = await db.query(
      `SELECT plan_data FROM user_learning_paths WHERE user_id = $1`,
      [session.user_id]
    );
    const learningPlan = planResult.rows[0] ? planResult.rows[0].plan_data : null;

    // Fetch progress
    const progressResult = await db.query(
      `SELECT material_slug FROM user_progress WHERE user_id = $1 AND status = 'completed'`,
      [session.user_id]
    );
    const completedSlugs = progressResult.rows.map(row => row.material_slug);

    res.json({
      isAuthenticated: true,
      walletAddress: session.wallet_address,
      username: session.username,
      integrityScore: session.integrity_score,
      isMock: session.is_mock,
      learningPlan,
      completedSlugs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Log user out by deleting session token
exports.logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await db.query(`DELETE FROM user_sessions WHERE token = $1`, [token]);
      console.log(`[authController] User session revoked.`);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Export active sessions placeholder for compatibility
exports.sessions = {};

