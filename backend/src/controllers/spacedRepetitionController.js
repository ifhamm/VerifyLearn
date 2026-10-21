const db = require('../utils/db');

// ─────────────────────────────────────────────────────────────────────────────
// Spaced repetition (SM-2 style) — Phase 4 Feature 7
//
// The `spaced_repetition` row is fully server-owned: clients may only report
// "did the learner get it right" for a material. `ease_factor`, `repetitions`,
// `lapses`, `interval_days` and the next review date are all derived
// server-side and are written with protected defaults (never NULL, never
// negative) — a client can never inject them.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_EASE = 2.5;

// Normalize a "was it correct" flag. Accepts booleans, 0/1 and the usual
// truthy/falsy strings. Anything not explicitly true counts as incorrect.
const toCorrect = (value) => {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'correct' || v === 'yes';
  }
  return false;
};

// GET /api/v1/review/schedule
// Lists every review row that is due (next_review_at <= now) for the caller.
exports.getSchedule = async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await db.query(
      `SELECT id,
              user_id,
              material_slug,
              ease_factor,
              interval_days,
              repetitions,
              lapses,
              last_reviewed,
              next_review_at,
              last_result
         FROM spaced_repetition
        WHERE user_id = $1
          AND next_review_at IS NOT NULL
          AND next_review_at <= CURRENT_TIMESTAMP
        ORDER BY next_review_at ASC, repetitions ASC`,
      [userId]
    );

    const items = result.rows || [];
    res.json({
      success: true,
      count: items.length,
      dueCount: items.length,
      items,
    });
  } catch (error) {
    console.error('Error fetching review schedule:', error);
    res.status(500).json({ error: 'Failed to fetch the review schedule.' });
  }
};

// POST /api/v1/review/result
// Body: { materialSlug, correct, lastResult }
// Applies the SM-2 update to the (user_id, material_slug) row.
//
// SM-2 (simplified, per spec):
//   correct   -> ease +0.1, repetitions +1, lapses unchanged,
//                 next review = now + interval_days * 2 days
//   incorrect -> ease -0.1, repetitions reset to 1, lapses +1,
//                 next review = now + 1 day
// `interval_days` keeps a protected default (never NULL/negative) and is only
// ever derived from the previous stored value.
exports.recordResult = async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};
    const materialSlug = typeof body.materialSlug === 'string' ? body.materialSlug.trim() : '';

    if (!materialSlug) {
      return res.status(400).json({ error: 'materialSlug is required.' });
    }

    const correct = toCorrect(body.correct);
    const lastResult =
      typeof body.lastResult === 'string' && body.lastResult.trim()
        ? body.lastResult.trim()
        : correct
        ? 'correct'
        : 'incorrect';

    // Make sure a row exists for this (user, material). On conflict we only
    // touch updated_at — the real update happens right after, so an existing
    // schedule is never reset by this call.
    await db.query(
      `INSERT INTO spaced_repetition
         (user_id, material_slug, ease_factor, interval_days, repetitions, lapses,
          last_reviewed, next_review_at, last_result)
       VALUES ($1, $2, $3, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
       ON CONFLICT (user_id, material_slug)
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      [userId, materialSlug, DEFAULT_EASE, lastResult]
    );

    // The whole SM-2 update runs in one statement, so the stored defaults
    // (COALESCE / GREATEST) are the only source of truth — no client input
    // can influence repetitions, lapses, interval_days or the next date.
    const updated = await db.query(
      `UPDATE spaced_repetition
          SET ease_factor = COALESCE(ease_factor, $5) + CASE WHEN $1 THEN 0.1 ELSE -0.1 END,
              repetitions = CASE WHEN $1 THEN GREATEST(0, COALESCE(repetitions, 0)) + 1 ELSE 1 END,
              lapses = CASE WHEN $1 THEN GREATEST(0, COALESCE(lapses, 0)) ELSE GREATEST(0, COALESCE(lapses, 0)) + 1 END,
              interval_days = CASE WHEN $1 THEN GREATEST(1, COALESCE(interval_days, 0) * 2) ELSE 1 END,
              last_reviewed = CURRENT_TIMESTAMP,
              next_review_at = CURRENT_TIMESTAMP
                             + (CASE WHEN $1 THEN GREATEST(1, COALESCE(interval_days, 0) * 2) ELSE 1 END || ' days')::INTERVAL,
              last_result = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3 AND material_slug = $4
        RETURNING material_slug, ease_factor, interval_days, repetitions, lapses,
                  last_reviewed, next_review_at, last_result`,
      [correct, lastResult, userId, materialSlug, DEFAULT_EASE]
    );

    if (!updated.rows || updated.rows.length === 0) {
      return res.status(404).json({ error: 'Spaced repetition record not found.' });
    }

    res.json({
      success: true,
      materialSlug,
      correct,
      lastResult,
      schedule: updated.rows[0],
    });
  } catch (error) {
    console.error('Error recording review result:', error);
    res.status(500).json({ error: 'Failed to record the review result.' });
  }
};

module.exports = {
  getSchedule: exports.getSchedule,
  recordResult: exports.recordResult,
};
