const crypto = require('crypto');
const db = require('../utils/db');

const SESSION_TTL_HOURS = 24;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function pruneExpiredSessions() {
  await db.query(
    'DELETE FROM user_sessions WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP'
  );
}

async function createSession(userId) {
  await pruneExpiredSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await db.query(
    'INSERT INTO user_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt]
  );

  return token;
}

async function findSession(token) {
  const result = await db.query(
    `SELECT s.token, u.id as user_id, u.wallet_address, u.username, u.integrity_score, u.is_mock
     FROM user_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)`,
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

async function deleteSession(token) {
  await db.query('DELETE FROM user_sessions WHERE token = $1', [hashToken(token)]);
}

module.exports = {
  hashToken,
  createSession,
  findSession,
  deleteSession,
  pruneExpiredSessions,
  SESSION_TTL_HOURS
};
