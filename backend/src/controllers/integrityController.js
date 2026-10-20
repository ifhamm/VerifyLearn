const aiService = require('../services/aiService');
const db = require('../utils/db');

exports.verifyKeystroke = async (req, res) => {
  try {
    const keystrokes = req.body.keystrokes || req.body.keystrokePattern;
    if (!keystrokes || !Array.isArray(keystrokes)) {
      return res.status(400).json({ error: 'Invalid or empty keystroke format.' });
    }

    const result = await aiService.analyzeKeystrokes(keystrokes);
    res.json(result);
  } catch (error) {
    console.error('Error verifying keystrokes:', error);
    res.status(500).json({ error: 'Failed to verify keystroke pattern.' });
  }
};

// GET /api/v1/integrity/score — current score plus the last 20 score events
exports.getScore = async (req, res) => {
  try {
    const userId = req.user.userId;

    const userRes = await db.query(
      `SELECT integrity_score FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const eventsRes = await db.query(
      `SELECT delta, score_before, score_after, status, reasons, created_at
       FROM integrity_events
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [userId]
    );

    const score = userRes.rows[0].integrity_score == null ? 100 : userRes.rows[0].integrity_score;
    res.json({ score, events: eventsRes.rows });
  } catch (error) {
    console.error('Error fetching integrity score:', error);
    res.status(500).json({ error: 'Failed to fetch integrity score.' });
  }
};
