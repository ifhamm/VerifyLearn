'use strict';

/**
 * Smoke test: Phase 4 Feature 6 — dashboard insights endpoint.
 */
const path = require('path');
const assert = require('assert');
const BACKEND = path.join(__dirname, '..');

const state = {
  users: new Map(),
  sessions: new Map(),
  paths: [],
  progress: [],
  quizResults: [],
  events: [],
};

function sha256(s) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(s).digest('hex');
}

function parsePlan(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return data || null;
}

function run(queryText, params) {
  const sql = String(queryText).replace(/\s+/g, ' ').trim();
  const p = params || [];

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }

  if (sql.includes('FROM user_sessions')) {
    // sessionService already hashes the token before querying
    const row = state.sessions.get(p[0]);
    return { rows: row ? [{ token: p[0], user_id: row.user_id, wallet_address: row.wallet_address, username: row.username, integrity_score: row.integrity_score, is_mock: row.is_mock }] : [], rowCount: row ? 1 : 0 };
  }

  if (sql.includes('SELECT integrity_score FROM users')) {
    const u = state.users.get(Number(p[0]));
    return { rows: u ? [{ integrity_score: u.integrity_score }] : [], rowCount: u ? 1 : 0 };
  }

  if (sql.includes('FROM integrity_events')) {
    const rows = state.events
      .filter((e) => e.user_id === Number(p[0]))
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map((e) => ({ delta: e.delta, score_before: e.score_before, score_after: e.score_after, status: e.status, reasons: e.reasons, created_at: e.created_at }));
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('SELECT material_slug, quiz_type, score,') && sql.includes('FROM quiz_results')) {
    const rows = state.quizResults
      .filter((r) => Number(r.user_id) === Number(p[0]))
      .map((r) => ({
        material_slug: r.material_slug,
        quiz_type: r.quiz_type,
        score: r.score,
        total_questions: r.total_questions,
        correct_answers: r.correct_answers,
        wpm: r.wpm,
        created_at: r.created_at,
      }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('SELECT plan_data')) {
    const rows = state.paths.filter((pl) => Number(pl.user_id) === Number(p[0]))
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, 1)
      .map((pl) => ({
        plan_data: pl.plan_data,
        duration_weeks: pl.duration_weeks,
        commitment_hours: pl.commitment_hours,
        role: pl.role,
      }));
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('SELECT material_slug, role, status') && sql.includes('FROM user_progress')) {
    const rows = state.progress.filter((pr) => Number(pr.user_id) === Number(p[0]))
      .map((pr) => ({ material_slug: pr.material_slug, role: pr.role, status: pr.status, completed_at: pr.completed_at }));
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

const fakeDb = {
  query: async (text, params) => run(text, params),
  pool: {
    connect: async () => ({
      query: async (text, params) => run(text, params),
      release: () => {},
    }),
  },
};

function inject(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj,
    children: [],
    paths: [],
  };
}

inject(path.join(BACKEND, 'src', 'utils', 'db.js'), fakeDb);

const express = require(path.join(BACKEND, 'node_modules', 'express'));
const apiRoutes = require(path.join(BACKEND, 'src', 'routes', 'apiRoutes.js'));

function shaToken(s) { return sha256(s); }

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  // Setup state for user 1
  state.users.set(1, { id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 96, is_mock: false });
  state.paths.push({
    user_id: 1,
    role: 'backend',
    plan_data: { role: 'backend', materials: [{ slug: 'intro-http', title: 'Intro', parent_topic: 'Web', status: 'wajib' }] },
    duration_weeks: 2,
    commitment_hours: 4,
    updated_at: Date.now(),
  });
  state.progress.push({ user_id: 1, role: 'backend', material_slug: 'intro-http', status: 'in_progress', completed_at: null });
  state.quizResults.push({
    user_id: 1,
    material_slug: 'intro-http',
    quiz_type: 'quiz',
    score: 85,
    total_questions: 2,
    correct_answers: 2,
    wpm: 45,
    created_at: new Date('2024-01-10'),
  });
  state.events.push({
    id: 1,
    user_id: 1,
    delta: +4,
    score_before: 92,
    score_after: 96,
    status: 'verified',
    reasons: [],
    created_at: new Date('2024-01-10'),
  });

  const token = 'smoke-token-alice';
  state.sessions.set(shaToken(token), {
    user_id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 96, is_mock: false
  });

  const res = await fetch(base + '/dashboard/insights', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();

  assert.strictEqual(res.status, 200, 'Expected status 200, got ' + res.status);
  assert(body && typeof body.mastery === 'object', 'mastery should be an object');
  assert(Array.isArray(body.wpmSeries), 'wpmSeries should be array');
  assert(typeof body.integrityScore === 'number', 'integrityScore should be number');
  assert(typeof body.accuracy === 'number', 'accuracy should be number');
  assert(typeof body.streakDays === 'number', 'streakDays should be number');
  assert(Array.isArray(body.weakTopics), 'weakTopics should be array');
  assert(body.recommendation && typeof body.recommendation.slug === 'string', 'recommendation should have slug');
  assert(typeof body.estimatedCompletionWeeks === 'number', 'estimatedCompletionWeeks should be number');

  console.log('Dashboard insights response:');
  console.log(JSON.stringify(body, null, 2));
  console.log('DASHBOARD SMOKE TEST OK');
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DASHBOARD SMOKE TEST CRASHED:', err);
  process.exit(1);
});
