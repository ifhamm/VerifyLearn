const db = require('../utils/db');

exports.getInsights = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const mastery = await db.query(`SELECT material_slug, AVG(score)::numeric(5,1) as mastery FROM quiz_results WHERE user_id = $1 GROUP BY material_slug`, [userId]);
    const integrity = await db.query(`SELECT integrity_score FROM users WHERE id = $1`, [userId]);
    res.json({ message: 'Dashboard insights', data: { mastery: mastery.rows, integrityScore: integrity.rows[0]?.integrity_score ?? 100 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
