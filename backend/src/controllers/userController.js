const db = require('../utils/db');

// Sync user learning progress, completed materials, and integrity score
exports.syncProgress = async (req, res) => {
  try {
    const { integrityScore, completedSlugs, learningPlan, resetProgress } = req.body;
    const userId = req.user.userId;

    if (resetProgress) {
      const targetRole = learningPlan ? (learningPlan.role || 'backend') : 'backend';
      await db.query(`DELETE FROM user_learning_paths WHERE user_id = $1 AND role = $2`, [userId, targetRole]);
      await db.query(`DELETE FROM user_progress WHERE user_id = $1 AND role = $2`, [userId, targetRole]);
      
      if (learningPlan && learningPlan.materials) {
        const slugs = learningPlan.materials.map(m => m.slug);
        
        // Handle module quizzes associated with this plan
        const moduleIds = [];
        learningPlan.materials.forEach(m => {
          const modId = m.module_id || m.moduleId || (m.module ? m.module.id : null);
          if (modId && !moduleIds.includes(modId)) {
            moduleIds.push(modId);
          }
        });
        
        // Also add potential quiz slugs to delete
        moduleIds.forEach(id => {
          slugs.push(`quiz-module-${id}`);
        });

        if (slugs.length > 0) {
          await db.query(
            `DELETE FROM quiz_results WHERE user_id = $1 AND material_slug = ANY($2)`,
            [userId, slugs]
          );
        }
      }
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
         ON CONFLICT (user_id, role) 
         DO UPDATE SET level = EXCLUDED.level, 
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

// Save or update notes for a specific material progress
exports.saveNote = async (req, res) => {
  try {
    const { materialSlug, role, notes } = req.body;
    const userId = req.user.userId;

    if (!materialSlug || !role) {
      return res.status(400).json({ error: 'materialSlug and role are required.' });
    }

    // Upsert note in user_progress. If row doesn't exist, create it with status 'in_progress'
    await db.query(
      `INSERT INTO user_progress (user_id, material_slug, role, notes, status, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, role, material_slug)
       DO UPDATE SET notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP`,
      [userId, materialSlug, role, notes || '']
    );

    res.json({ success: true, message: 'Note saved successfully.' });
  } catch (error) {
    console.error('Error saving note:', error);
    res.status(500).json({ error: error.message });
  }
};

// Retrieve notes for a specific material
exports.getNote = async (req, res) => {
  try {
    const { materialSlug, role } = req.query;
    const userId = req.user.userId;

    if (!materialSlug || !role) {
      return res.status(400).json({ error: 'materialSlug and role are required.' });
    }

    const result = await db.query(
      `SELECT notes FROM user_progress 
       WHERE user_id = $1 AND material_slug = $2 AND role = $3`,
      [userId, materialSlug, role]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, notes: result.rows[0].notes || '' });
    } else {
      res.json({ success: true, notes: '' });
    }
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ error: error.message });
  }
};
