const db = require('../utils/db');

// Integrity score deltas per verification outcome
const STATUS_DELTAS = {
  verified: 4,
  review_required: 0,
  high_risk: -15,
};

const clampScore = (value) => Math.max(0, Math.min(100, value));

// Combine the collected signals into a verdict: status + delta + reasons.
// This is a pure function — use apply() to persist the result.
const evaluate = ({
  keystrokeResult,
  pasteDetected,
  focusLossCount,
  voiceResult,
  lateSubmission,
  aiUnavailable,
} = {}) => {
  // Fail-closed: never award a verdict we could not actually verify.
  if (aiUnavailable) {
    return { status: 'review_required', delta: 0, reasons: ['ai_service_unavailable'] };
  }

  const reasons = [];
  let status = 'verified';
  const keystrokePassed = !!(keystrokeResult && keystrokeResult.verified === true);

  if (voiceResult) {
    // A resolved voice challenge is the authoritative human-presence signal
    if (voiceResult.passed) {
      status = 'verified';
      reasons.push('voice_verification_passed');
    } else {
      status = 'high_risk';
      reasons.push('voice_verification_failed');
    }
  } else {
    if (!keystrokePassed) {
      status = 'high_risk';
      reasons.push('keystroke_verification_failed');
    }
    if (pasteDetected) {
      reasons.push('paste_detected');
      // Paste alone requires review; combined with a failed keystroke check it stays high_risk
      if (status === 'verified') status = 'review_required';
    }
  }

  if (Number(focusLossCount) > 0) {
    reasons.push('focus_loss_detected');
  }

  // Late submissions always sit at review_required or worse
  if (lateSubmission) {
    reasons.push('time_anomaly');
    if (status === 'verified') status = 'review_required';
  }

  return { status, delta: STATUS_DELTAS[status], reasons };
};

// Persist a verdict: the ONLY writer of users.integrity_score.
// Reads the current score, applies the clamped delta, and appends an
// integrity_events row — all inside a single transaction.
const apply = async (userId, assessment, attemptId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT integrity_score FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      throw new Error('User not found');
    }

    const scoreBefore = userRes.rows[0].integrity_score == null ? 100 : userRes.rows[0].integrity_score;
    const delta = Number(assessment.delta) || 0;
    const scoreAfter = clampScore(scoreBefore + delta);

    await client.query(
      `UPDATE users SET integrity_score = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [scoreAfter, userId]
    );

    await client.query(
      `INSERT INTO integrity_events (user_id, attempt_id, delta, score_before, score_after, status, reasons)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        attemptId || null,
        delta,
        scoreBefore,
        scoreAfter,
        assessment.status,
        JSON.stringify(assessment.reasons || []),
      ]
    );

    await client.query('COMMIT');

    return {
      status: assessment.status,
      delta,
      scoreBefore,
      scoreAfter,
      reasons: assessment.reasons || [],
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error rolling back integrity transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  evaluate,
  apply,
};
