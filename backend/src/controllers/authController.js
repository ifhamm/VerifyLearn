const { ethers } = require('ethers');
const crypto = require('crypto');
const db = require('../utils/db');
const sessionService = require('../services/sessionService');

const APP_ENV = process.env.APP_ENV || 'development';
const IS_PRODUCTION = APP_ENV === 'production';
const NONCE_TTL_MINUTES = 5;

const WALLET_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const USERNAME_RE = /^[A-Za-z0-9_\-. ]{3,32}$/;

// Mock login is a development convenience only. In production it is disabled
// unless ALLOW_MOCK_LOGIN=true is set explicitly (never recommended).
function isMockLoginAllowed() {
  if (process.env.ALLOW_MOCK_LOGIN !== undefined) {
    return process.env.ALLOW_MOCK_LOGIN === 'true';
  }
  return !IS_PRODUCTION;
}

// Deterministic simulated wallet derived from the username. The client can no
// longer choose or spoof the address used for a mock login.
function deriveMockAddress(username) {
  const hash = crypto
    .createHash('sha256')
    .update(`verifylearn-mock:${username.toLowerCase()}`)
    .digest('hex');
  return `0x${hash.slice(0, 40)}`;
}

function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

// Issue a single-use, short-lived login challenge bound to a wallet address.
exports.requestNonce = async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || !WALLET_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'A valid wallet address is required.' });
    }

    const walletAddress = address.toLowerCase();
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const message = [
      'VerifyLearn wants you to sign in with your Ethereum account:',
      walletAddress,
      '',
      'Sign this message to prove wallet ownership. This request will not trigger a blockchain transaction or cost any gas.',
      '',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`
    ].join('\n');

    const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60 * 1000);

    await db.query(
      `INSERT INTO auth_nonces (nonce, wallet_address, message, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [nonce, walletAddress, message, expiresAt]
    );

    // Opportunistic cleanup of stale challenges for this wallet
    await db.query(
      `DELETE FROM auth_nonces
       WHERE wallet_address = $1 AND (used = TRUE OR expires_at <= CURRENT_TIMESTAMP)`,
      [walletAddress]
    );

    return res.json({
      nonce,
      message,
      issuedAt,
      expiresIn: NONCE_TTL_MINUTES * 60
    });
  } catch (error) {
    console.error('[authController] requestNonce error:', error);
    return res.status(500).json({ error: 'Failed to issue login challenge.' });
  }
};

// Verify message signature and establish session
exports.login = async (req, res) => {
  try {
    const { address, signature, message, nonce, username, isMock } = req.body;

    let userAddress;
    let finalUsername;

    if (isMock) {
      if (!isMockLoginAllowed()) {
        return res.status(403).json({
          error: 'Simulated login is disabled in this environment.'
        });
      }

      if (!isValidUsername(username)) {
        return res.status(400).json({
          error: 'Username must be 3-32 characters using only letters, numbers, spaces, dots, hyphens or underscores.'
        });
      }

      finalUsername = username.trim();
      userAddress = deriveMockAddress(finalUsername);
    } else {
      if (!address || !WALLET_ADDRESS_RE.test(address)) {
        return res.status(400).json({ error: 'A valid wallet address is required.' });
      }

      if (!signature || !message || !nonce) {
        return res.status(400).json({
          error: 'Signature, message and nonce are required. Request a challenge via /auth/nonce first.'
        });
      }

      userAddress = address.toLowerCase();

      // Look up the server-issued challenge. It must exist, be unexpired,
      // unused, bound to this address, and match the signed message verbatim.
      const nonceResult = await db.query(
        `SELECT nonce, message, used, expires_at
         FROM auth_nonces
         WHERE nonce = $1 AND wallet_address = $2`,
        [nonce, userAddress]
      );
      const challenge = nonceResult.rows[0];

      if (!challenge) {
        return res.status(401).json({ error: 'Login challenge not found. Please request a new one.' });
      }
      if (challenge.used) {
        return res.status(401).json({ error: 'Login challenge already used. Please request a new one.' });
      }
      if (new Date(challenge.expires_at) <= new Date()) {
        return res.status(401).json({ error: 'Login challenge expired. Please request a new one.' });
      }
      if (challenge.message !== message) {
        return res.status(401).json({ error: 'Signed message does not match the issued challenge.' });
      }

      let recoveredAddress;
      try {
        recoveredAddress = ethers.verifyMessage(message, signature);
      } catch (err) {
        console.error('[authController] ethers verifyMessage error:', err);
        return res.status(400).json({ error: 'Failed to verify cryptographic signature.' });
      }

      if (recoveredAddress.toLowerCase() !== userAddress) {
        return res.status(401).json({ error: 'Signature verification failed. Address mismatch.' });
      }

      // Consume the challenge so it can never be replayed
      await db.query(`UPDATE auth_nonces SET used = TRUE WHERE nonce = $1`, [nonce]);

      finalUsername = isValidUsername(username)
        ? username.trim()
        : `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    }

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

    // Fetch user's existing learning plans if any
    const planResult = await db.query(
      `SELECT plan_data FROM user_learning_paths WHERE user_id = $1`,
      [user.id]
    );
    const learningPlans = planResult.rows.map(row => row.plan_data);
    const learningPlan = learningPlans[0] || null;

    // Fetch user's existing completed slugs
    const progressResult = await db.query(
      `SELECT material_slug FROM user_progress WHERE user_id = $1 AND status = 'completed'`,
      [user.id]
    );
    const completedSlugs = progressResult.rows.map(row => row.material_slug);

    // Create session (token returned once; only its hash is stored)
    const sessionToken = await sessionService.createSession(user.id);

    console.log(`[authController] User login successful. Address: ${userAddress}, Username: ${user.username}, Mock: ${!!isMock}`);

    return res.json({
      success: true,
      message: 'Authenticated successfully',
      token: sessionToken,
      walletAddress: userAddress,
      username: user.username,
      integrityScore: user.integrity_score,
      learningPlan,
      learningPlans,
      completedSlugs
    });
  } catch (error) {
    console.error('[authController] Login error:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
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
    const session = await sessionService.findSession(token);

    if (!session) {
      return res.status(401).json({ isAuthenticated: false, error: 'Session has expired or is invalid.' });
    }

    // Fetch learning plans
    const planResult = await db.query(
      `SELECT plan_data FROM user_learning_paths WHERE user_id = $1`,
      [session.user_id]
    );
    const learningPlans = planResult.rows.map(row => row.plan_data);
    const learningPlan = learningPlans[0] || null;

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
      learningPlans,
      completedSlugs
    });
  } catch (error) {
    console.error('[authController] checkSession error:', error);
    res.status(500).json({ error: 'Internal server error during session check.' });
  }
};

// Log user out by deleting session token
exports.logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await sessionService.deleteSession(token);
      console.log('[authController] User session revoked.');
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[authController] logout error:', error);
    res.status(500).json({ error: 'Internal server error during logout.' });
  }
};
