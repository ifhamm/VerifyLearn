const db = require('../utils/db');

// Sync user learning progress, completed materials, and integrity score
exports.syncProgress = async (req, res) => {
  try {
    const { integrityScore, completedSlugs, learningPlan, resetProgress } = req.body;
    const userId = req.user.userId;

    if (resetProgress) {
      await db.query(`DELETE FROM user_learning_paths WHERE user_id = $1`, [userId]);
      await db.query(`DELETE FROM user_progress WHERE user_id = $1`, [userId]);
    }

    if (integrityScore !== undefined) {
      await db.query(
        `UPDATE users SET integrity_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [parseInt(integrityScore, 10), userId]
      );
    }

    if (learningPlan) {
      await db.query(
        `INSERT INTO user_learning_paths (user_id, role, level, duration_weeks, commitment_hours, plan_data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) 
         DO UPDATE SET role = EXCLUDED.role, level = EXCLUDED.level, 
                       duration_weeks = EXCLUDED.duration_weeks, commitment_hours = EXCLUDED.commitment_hours,
                       plan_data = EXCLUDED.plan_data, updated_at = CURRENT_TIMESTAMP`,
        [
          userId,
          learningPlan.role || 'backend',
          learningPlan.level || 'beginner',
          parseInt(learningPlan.total_weeks || 4, 10),
          parseFloat(learningPlan.hours_per_week || 8),
          learningPlan
        ]
      );
    }

    if (completedSlugs && Array.isArray(completedSlugs)) {
      // Find role to associate with progress
      let role = 'backend';
      if (learningPlan && learningPlan.role) {
        role = learningPlan.role;
      } else {
        const roleRes = await db.query(`SELECT role FROM user_learning_paths WHERE user_id = $1`, [userId]);
        if (roleRes.rows[0]) {
          role = roleRes.rows[0].role;
        }
      }

      for (const slug of completedSlugs) {
        await db.query(
          `INSERT INTO user_progress (user_id, material_slug, role, status, completed_at, updated_at)
           VALUES ($1, $2, $3, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, role, material_slug)
           DO UPDATE SET status = 'completed', completed_at = COALESCE(user_progress.completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP`,
          [userId, slug, role]
        );
      }
    }

    res.json({ success: true, message: 'Progress synced successfully.' });
  } catch (error) {
    console.error('Error syncing user progress:', error);
    res.status(500).json({ error: error.message });
  }
};

// Store quiz or challenge result
exports.saveQuizResult = async (req, res) => {
  try {
    const {
      materialSlug,
      quizType,
      score,
      totalQuestions,
      correctAnswers,
      details,
      keystrokeVerified,
      keystrokeScore
    } = req.body;

    const userId = req.user.userId;

    if (!materialSlug || !quizType) {
      return res.status(400).json({ error: 'materialSlug and quizType are required.' });
    }

    await db.query(
      `INSERT INTO quiz_results (
        user_id, material_slug, quiz_type, score, total_questions, 
        correct_answers, details, keystroke_verified, keystroke_score, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
      [
        userId,
        materialSlug,
        quizType,
        parseFloat(score || 0),
        parseInt(totalQuestions || 0, 10),
        parseInt(correctAnswers || 0, 10),
        details || {},
        keystrokeVerified === undefined ? true : !!keystrokeVerified,
        keystrokeScore === undefined ? null : parseFloat(keystrokeScore)
      ]
    );

    res.json({ success: true, message: 'Quiz result saved successfully.' });
  } catch (error) {
    console.error('Error saving quiz result:', error);
    res.status(500).json({ error: error.message });
  }
};

// Retrieve latest quiz result
exports.getQuizResult = async (req, res) => {
  try {
    const { materialSlug, quizType } = req.query;
    const userId = req.user.userId;

    if (!materialSlug || !quizType) {
      return res.status(400).json({ error: 'materialSlug and quizType are required.' });
    }

    const result = await db.query(
      `SELECT * FROM quiz_results 
       WHERE user_id = $1 AND material_slug = $2 AND quiz_type = $3 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, materialSlug, quizType]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error('Error fetching quiz result:', error);
    res.status(500).json({ error: error.message });
  }
};

// Retrieve all quiz results for the user
exports.getAllQuizResults = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
      `SELECT * FROM quiz_results 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching all quiz results:', error);
    res.status(500).json({ error: error.message });
  }
};
