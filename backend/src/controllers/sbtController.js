const db = require('../utils/db');
const blockchainService = require('../services/blockchainService');

exports.getUserSBTs = async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await db.query(
      `SELECT id, module_id, tx_hash, token_id, minted_at 
       FROM user_sbts 
       WHERE user_id = $1 
       ORDER BY minted_at ASC`,
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching user SBTs:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.mintSBT = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { moduleId } = req.body; // 'module_1', 'module_2', 'module_3', 'module_4', or 'final'

    if (!moduleId) {
      return res.status(400).json({ error: 'moduleId is required.' });
    }

    // 1. Check if already minted
    const existing = await db.query(
      `SELECT * FROM user_sbts WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Soulbound Token already minted for this module.' });
    }

    // 2. Fetch user wallet and integrity score
    const userRes = await db.query(
      `SELECT wallet_address, integrity_score FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const { wallet_address: walletAddress, integrity_score: integrityScore } = userRes.rows[0];

    // 3. Verify integrity score threshold (>= 70)
    if (integrityScore < 70) {
      return res.status(400).json({ 
        error: `Your Integrity Score (${integrityScore}) is below the threshold of 70 required to claim an on-chain credential.` 
      });
    }

    // 4. Verify module or final path completion
    if (moduleId === 'final') {
      // Check if all 4 modules are completed (by checking if their quizzes are done)
      for (let i = 1; i <= 4; i++) {
        const quizSlug = `quiz-module-${i}`;
        const progressRes = await db.query(
          `SELECT id FROM user_progress WHERE user_id = $1 AND material_slug = $2 AND status = 'completed'`,
          [userId, quizSlug]
        );
        const resultsRes = await db.query(
          `SELECT id FROM quiz_results WHERE user_id = $1 AND material_slug = $2`,
          [userId, quizSlug]
        );
        if (progressRes.rows.length === 0 && resultsRes.rows.length === 0) {
          return res.status(400).json({ 
            error: `Please complete all 4 modules (and pass their quizzes) before claiming the Master Certificate.` 
          });
        }
      }
    } else {
      // It's a module. Extract the module number (e.g. 'module_1' -> '1')
      const match = moduleId.match(/^module_(\d+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid moduleId format.' });
      }
      const moduleNum = match[1];
      const quizSlug = `quiz-module-${moduleNum}`;

      const progressRes = await db.query(
        `SELECT id FROM user_progress WHERE user_id = $1 AND material_slug = $2 AND status = 'completed'`,
        [userId, quizSlug]
      );
      const resultsRes = await db.query(
        `SELECT id FROM quiz_results WHERE user_id = $1 AND material_slug = $2`,
        [userId, quizSlug]
      );
      if (progressRes.rows.length === 0 && resultsRes.rows.length === 0) {
        return res.status(400).json({ 
          error: `Please complete this module and pass its module quiz before minting your on-chain badge.` 
        });
      }
    }

    // 5. Mint on-chain using Ethers service
    console.log(`[SBT Controller] Requesting SBT mint for user: ${userId}, wallet: ${walletAddress}, moduleId: ${moduleId}`);
    const mintResult = await blockchainService.mintSBT(walletAddress, moduleId);

    // 6. Save in DB
    await db.query(
      `INSERT INTO user_sbts (user_id, module_id, tx_hash, token_id, minted_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, moduleId, mintResult.transactionHash, mintResult.tokenId]
    );

    res.json({
      success: true,
      message: 'SBT minted successfully on-chain.',
      data: {
        moduleId,
        txHash: mintResult.transactionHash,
        tokenId: mintResult.tokenId
      }
    });

  } catch (error) {
    console.error('Error minting SBT:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.verifySBT = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // Convert to lowercase to ensure matching works properly
    const addr = walletAddress.toLowerCase();
    
    // Find user
    const userRes = await db.query(
      `SELECT id, username, wallet_address, integrity_score FROM users WHERE LOWER(wallet_address) = $1`,
      [addr]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User/Wallet not found in the system.' });
    }
    
    const user = userRes.rows[0];
    
    // Find their SBTs
    const sbtRes = await db.query(
      `SELECT module_id, tx_hash, token_id, minted_at 
       FROM user_sbts 
       WHERE user_id = $1 
       ORDER BY minted_at ASC`,
      [user.id]
    );
    
    res.json({
      success: true,
      user: {
        username: user.username,
        walletAddress: user.wallet_address,
        integrityScore: user.integrity_score
      },
      sbts: sbtRes.rows
    });
    
  } catch (error) {
    console.error('Error verifying SBT:', error);
    res.status(500).json({ error: error.message });
  }
};
