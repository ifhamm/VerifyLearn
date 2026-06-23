const { ethers } = require('ethers');
const crypto = require('crypto');

// In-memory session store mapping token -> session data
const sessions = {};

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
      // Create session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const userAddress = address.toLowerCase();
      
      // Save session
      sessions[sessionToken] = {
        walletAddress: userAddress,
        username: username || `${address.slice(0, 6)}...${address.slice(-4)}`,
        isMock: !!isMock,
        createdAt: new Date()
      };

      console.log(`[authController] User login successful. Address: ${userAddress}, Username: ${sessions[sessionToken].username}, SessionToken: ${sessionToken.slice(0, 8)}...`);

      return res.json({
        success: true,
        message: 'Authenticated successfully',
        token: sessionToken,
        walletAddress: userAddress,
        username: sessions[sessionToken].username
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
    const session = sessions[token];

    if (!session) {
      return res.status(401).json({ isAuthenticated: false, error: 'Session has expired or is invalid.' });
    }

    res.json({
      isAuthenticated: true,
      walletAddress: session.walletAddress,
      username: session.username,
      isMock: session.isMock
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
      if (sessions[token]) {
        console.log(`[authController] User logged out: ${sessions[token].walletAddress}`);
        delete sessions[token];
      }
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Export active sessions helper (useful for middleware check)
exports.sessions = sessions;
