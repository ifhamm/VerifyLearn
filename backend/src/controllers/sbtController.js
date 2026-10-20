const db = require('../utils/db');
const blockchainService = require('../services/blockchainService');

// A module quiz only counts towards the completion gate when the result was
// graded by the server (source = 'server') and was not flagged high-risk.
// Client-written rows (legacy or forged user_progress) never satisfy this.
const hasServerGradedQuiz = async (userId, quizSlug) => {
  const result = await db.query(
    `SELECT id FROM quiz_results
     WHERE user_id = $1 AND material_slug = $2
       AND source = 'server'
       AND integrity_status IS DISTINCT FROM 'high_risk'`,
    [userId, quizSlug]
  );
  return result.rows.length > 0;
};

exports.getUserSBTs = async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await db.query(
      `SELECT id, module_id, tx_hash, token_id, minted_at, status, simulated
       FROM user_sbts
       WHERE user_id = $1 AND status <> 'failed'
       ORDER BY minted_at ASC`,
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching user SBTs:', error);
    res.status(500).json({ error: 'Failed to fetch credentials.' });
  }
};

exports.mintSBT = async (req, res) => {
  let sbtRowId = null;
  try {
    const userId = req.user.userId;
    const { moduleId } = req.body; // 'module_1', 'module_2', 'module_3', 'module_4', or 'final'

    if (!moduleId) {
      return res.status(400).json({ error: 'moduleId is required.' });
    }

    // 1. Resolve any existing row. Legacy rows default to 'confirmed' and
    //    block re-mints; 'failed' rows are retried by reusing the same row;
    //    'pending' rows mean a mint is already in flight.
    const existing = await db.query(
      `SELECT id, status FROM user_sbts WHERE user_id = $1 AND module_id = $2`,
      [userId, moduleId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'pending') {
        return res.status(409).json({ error: 'A mint for this module is already in progress.' });
      }
      if (row.status === 'confirmed') {
        return res.status(400).json({ error: 'Soulbound Token already minted for this module.' });
      }
      sbtRowId = row.id; // status === 'failed' → retry reuses this row
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
        const quizOk = await hasServerGradedQuiz(userId, quizSlug);
        if (!quizOk) {
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

      const quizOk = await hasServerGradedQuiz(userId, quizSlug);
      if (!quizOk) {
        return res.status(400).json({ 
          error: `Please complete this module and pass its module quiz before minting your on-chain badge.` 
        });
      }
    }

    // 5. Reserve an honest 'pending' row BEFORE touching the chain, so a
    //    crash mid-mint leaves a truthful record instead of nothing.
    if (sbtRowId) {
      await db.query(`UPDATE user_sbts SET status = 'pending' WHERE id = $1`, [sbtRowId]);
    } else {
      try {
        const insert = await db.query(
          `INSERT INTO user_sbts (user_id, module_id, tx_hash, token_id, status)
           VALUES ($1, $2, '', NULL, 'pending')
           RETURNING id`,
          [userId, moduleId]
        );
        sbtRowId = insert.rows[0].id;
      } catch (insertErr) {
        if (insertErr.code === '23505') {
          return res.status(409).json({ error: 'A mint for this module is already in progress.' });
        }
        throw insertErr;
      }
    }

    // 6. Mint (real chain or explicitly simulated — the service decides,
    //    but in real mode it THROWS instead of fabricating a hash).
    console.log(`[SBT Controller] Requesting SBT mint for user: ${userId}, wallet: ${walletAddress}, moduleId: ${moduleId}`);
    try {
      const mintResult = await blockchainService.mintSBT(walletAddress, moduleId);

      await db.query(
        `UPDATE user_sbts
         SET tx_hash = $1, token_id = $2, status = 'confirmed', simulated = $3, minted_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [mintResult.transactionHash, mintResult.tokenId, mintResult.simulated === true, sbtRowId]
      );

      res.json({
        success: true,
        message: mintResult.simulated
          ? 'Credential recorded in simulated mode (development) — this is NOT an on-chain mint.'
          : 'SBT minted successfully on-chain.',
        data: {
          moduleId,
          txHash: mintResult.transactionHash,
          tokenId: mintResult.tokenId,
          simulated: mintResult.simulated === true
        }
      });
    } catch (mintErr) {
      // Real-mode failure: mark the row failed and tell the truth — never
      // return a fabricated transaction hash.
      console.error('Error minting SBT:', mintErr);
      await db
        .query(`UPDATE user_sbts SET status = 'failed' WHERE id = $1`, [sbtRowId])
        .catch((markErr) => console.error('Failed to mark SBT row as failed:', markErr));

      if (mintErr.code === 'NOT_CONFIGURED' || mintErr.code === 'ONCHAIN_FAILED') {
        return res.status(502).json({
          error: 'Blockchain mint failed — no credential was recorded on-chain. Please retry.'
        });
      }
      return res.status(500).json({ error: 'Mint failed unexpectedly. Please retry.' });
    }

  } catch (error) {
    console.error('Error minting SBT:', error);
    res.status(500).json({ error: 'Mint failed unexpectedly. Please retry.' });
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
    
    // Find their SBTs (failed rows are not credentials — they never reached
    // the chain and are excluded from public verification)
    const sbtRes = await db.query(
      `SELECT module_id, tx_hash, token_id, minted_at, status, simulated
       FROM user_sbts 
       WHERE user_id = $1 AND status <> 'failed'
       ORDER BY minted_at ASC`,
      [user.id]
    );

    // Cross-check every confirmed, non-simulated credential against the real
    // chain. Simulated or still-pending records are reported as exactly that
    // instead of being presented as verified.
    const mode = blockchainService.getMode();
    const sbts = await Promise.all(
      sbtRes.rows.map(async (row) => {
        let onChain;
        if (row.status !== 'confirmed') {
          onChain = { checked: false, valid: false, mode, reason: `mint_${row.status}` };
        } else {
          try {
            onChain = await blockchainService.verifyOnChain({
              walletAddress: user.wallet_address,
              moduleId: row.module_id,
              tokenId: row.token_id,
              txHash: row.tx_hash,
              simulated: row.simulated,
            });
          } catch (e) {
            console.error('On-chain verification error:', e);
            onChain = { checked: false, valid: false, mode, reason: 'verification_error' };
          }
        }
        return { ...row, onChain };
      })
    );
    
    res.json({
      success: true,
      blockchain: { mode },
      user: {
        username: user.username,
        walletAddress: user.wallet_address,
        integrityScore: user.integrity_score
      },
      sbts
    });
    
  } catch (error) {
    console.error('Error verifying SBT:', error);
    res.status(500).json({ error: 'Failed to verify credentials.' });
  }
};
