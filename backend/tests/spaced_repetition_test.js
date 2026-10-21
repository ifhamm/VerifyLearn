'use strict';

/**
 * Smoke test: Phase 4 Feature 7 (spaced repetition) + Feature 8
 * (pre/post-test tracking).
 *
 * Stubs src/utils/db.js and src/services/aiService.js via require.cache,
 * mounts the real router on an ephemeral express app and exercises the
 * contract end-to-end over HTTP.
 *
 * Run from the backend workdir: node tests/spaced_repetition_test.js
 */

const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const BACKEND = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// In-memory fake database
// ---------------------------------------------------------------------------
const state = {
  seq: 0,
  users: new Map(),
  sessions: new Map(),
  spaced: [],
  quizResults: [],
  attempts: [],
};

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const TOKEN_A = 'sr-token-alice';
const TOKEN_B = 'sr-token-bob';

state.users.set(1, { id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 100, is_mock: false });
state.users.set(2, { id: 2, wallet_address: '0xbbb', username: 'bob', integrity_score: 100, is_mock: false });
state.sessions.set(sha256(TOKEN_A), { user_id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 100, is_mock: false });
state.sessions.set(sha256(TOKEN_B), { user_id: 2, wallet_address: '0xbbb', username: 'bob', integrity_score: 100, is_mock: false });

// --- spaced repetition helpers ---------------------------------------------
const findSpaced = (userId, slug) =>
  state.spaced.find((r) => Number(r.user_id) === Number(userId) && r.material_slug === slug);

// The controller stores the SM-2 maths in a single UPDATE statement. The fake
// DB emulates the resulting values instead of parsing the SQL.
const applySm2 = (row, correct) => {
  const ease = row.ease_factor === null || row.ease_factor === undefined ? 2.5 : row.ease_factor;
  const intervalDays = row.interval_days || 0;
  const repetitions = row.repetitions || 0;
  const lapses = row.lapses || 0;

  row.ease_factor = Math.round((ease + (correct ? 0.1 : -0.1)) * 100) / 100;
  row.repetitions = correct ? Math.max(0, repetitions) + 1 : 1;
  row.lapses = correct ? Math.max(0, lapses) : Math.max(0, lapses) + 1;
  row.interval_days = correct ? Math.max(1, intervalDays * 2) : 1;
  row.last_reviewed = new Date();
  const days = correct ? Math.max(1, intervalDays * 2) : 1;
  row.next_review_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  row.updated_at = new Date();
  return row;
};

function run(rawText, rawParams) {
  const sql = String(rawText).replace(/\s+/g, ' ').trim();
  const params = rawParams || [];

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

  if (sql.includes('FROM user_sessions')) {
    const row = state.sessions.get(params[0]);
    return { rows: row ? [Object.assign({}, row)] : [], rowCount: row ? 1 : 0 };
  }

  if (sql.includes('SELECT integrity_score FROM users')) {
    const u = state.users.get(Number(params[0]));
    return { rows: u ? [{ integrity_score: u.integrity_score }] : [], rowCount: u ? 1 : 0 };
  }

  // ── spaced repetition ────────────────────────────────────────────────────
  if (sql.includes('INSERT INTO spaced_repetition')) {
    const existing = findSpaced(params[0], params[1]);
    if (existing) return { rows: [], rowCount: 1 };
    state.spaced.push({
      id: state.spaced.length + 1,
      user_id: params[0],
      material_slug: params[1],
      ease_factor: params[2],
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      last_reviewed: new Date(),
      next_review_at: new Date(),
      last_result: params[3],
      created_at: new Date(),
      updated_at: new Date(),
      _seq: ++state.seq,
    });
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('UPDATE spaced_repetition') && sql.includes('RETURNING')) {
    const row = findSpaced(params[2], params[3]);
    if (!row) return { rows: [], rowCount: 0 };
    const correct = params[0] === true;
    row.last_result = params[1];
    applySm2(row, correct);
    return {
      rows: [
        {
          material_slug: row.material_slug,
          ease_factor: row.ease_factor,
          interval_days: row.interval_days,
          repetitions: row.repetitions,
          lapses: row.lapses,
          last_reviewed: row.last_reviewed,
          next_review_at: row.next_review_at,
          last_result: row.last_result,
        },
      ],
      rowCount: 1,
    };
  }

  if (sql.includes('FROM spaced_repetition') && sql.includes('next_review_at <= CURRENT_TIMESTAMP')) {
    const rows = state.spaced
      .filter((r) => Number(r.user_id) === Number(params[0]) && r.next_review_at <= new Date())
      .sort((a, b) => a.next_review_at - b.next_review_at)
      .map((r) => ({
        id: r.id,
        user_id: r.user_id,
        material_slug: r.material_slug,
        ease_factor: r.ease_factor,
        interval_days: r.interval_days,
        repetitions: r.repetitions,
        lapses: r.lapses,
        last_reviewed: r.last_reviewed,
        next_review_at: r.next_review_at,
        last_result: r.last_result,
      }));
    return { rows, rowCount: rows.length };
  }

  // ── diagnostic (pre/post) ───────────────────────────────────────────────
  if (sql.includes('FROM quiz_results') && sql.includes('test_type = $2')) {
    let rows = state.quizResults.filter(
      (r) => Number(r.user_id) === Number(params[0]) && r.test_type === params[1]
    );
    if (params[2]) rows = rows.filter((r) => r.material_slug === params[2]);
    rows = rows
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 1)
      .map((r) => ({
        id: r.id,
        user_id: r.user_id,
        material_slug: r.material_slug,
        quiz_type: r.quiz_type,
        score: r.score,
        total_questions: r.total_questions,
        correct_answers: r.correct_answers,
        test_type: r.test_type,
        attempt_id: r.attempt_id,
        integrity_status: r.integrity_status,
        created_at: r.created_at,
      }));
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('INSERT INTO quiz_results')) {
    state.quizResults.push({
      id: state.quizResults.length + 1,
      user_id: params[0],
      material_slug: params[1],
      quiz_type: params[2],
      score: params[3],
      total_questions: params[4],
      correct_answers: params[5],
      details: params[6],
      keystroke_verified: params[7],
      keystroke_score: params[8],
      attempt_id: params[9],
      source: 'server',
      integrity_status: params[10],
      wpm: params[11],
      test_type: params[12],
      created_at: new Date(),
      _seq: ++state.seq,
    });
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('FROM assessment_attempts WHERE user_id = $1 AND material_slug')) {
    const rows = state.attempts
      .filter(
        (a) =>
          Number(a.user_id) === Number(params[0]) &&
          a.material_slug === params[1] &&
          a.quiz_type === params[2] &&
          (a.test_type || 'assessment') === params[3]
      )
      .sort((a, b) => b._seq - a._seq);
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('INSERT INTO assessment_attempts')) {
    state.attempts.push({
      id: params[0],
      user_id: params[1],
      material_slug: params[2],
      quiz_type: params[3],
      role: params[4],
      status: 'in_progress',
      questions: params[5],
      answer_key: params[6],
      started_at: params[7],
      expires_at: params[8],
      test_type: params[9],
      hints_used: 0,
      created_at: new Date(),
      _seq: ++state.seq,
    });
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('FROM assessment_attempts WHERE id = $1')) {
    const row = state.attempts.find((a) => a.id === params[0]);
    if (!row) return { rows: [], rowCount: 0 };
    const out = Object.assign({}, row);
    ['questions', 'answer_key', 'voice_challenge', 'integrity'].forEach((col) => {
      if (typeof out[col] === 'string') {
        try {
          out[col] = JSON.parse(out[col]);
        } catch (e) {
          out[col] = null;
        }
      }
    });
    return { rows: [out], rowCount: 1 };
  }

  if (sql.includes('SET status = $1, submitted_at')) {
    const row = state.attempts.find((a) => a.id === params[3] && a.status === 'in_progress');
    if (row) {
      row.status = params[0];
      row.submitted_at = params[1];
      row.integrity = params[2];
    }
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('INSERT INTO user_progress')) {
    return { rows: [], rowCount: 1 };
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

// ---------------------------------------------------------------------------
// Stubbed aiService
// ---------------------------------------------------------------------------
const FIXTURE_QUIZ = [
  {
    type: 'multiple_choice',
    question: 'What does HTTP stand for?',
    options: ['A. HyperText Transfer Protocol', 'B. Other'],
    correct_answer: 'A',
    explanation: 'HTTP = HyperText Transfer Protocol.',
    difficulty: 'easy',
  },
];

const fakeAiService = {
  generateQuiz: async () => FIXTURE_QUIZ.map((q) => Object.assign({}, q)),
  analyzeKeystrokes: async () => ({
    verified: true,
    confidence: 0.95,
    message: 'ok',
    metrics: { wpm: 60 },
  }),
  gradeEssay: async () => ({ score: 80, feedback: 'ok' }),
  generateVoiceChallenge: async () => ({ question: 'explain', keywords: ['a'] }),
  verifyVoice: async () => ({ passed: true, feedback: 'ok' }),
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
inject(path.join(BACKEND, 'src', 'services', 'aiService.js'), fakeAiService);

const express = require(path.join(BACKEND, 'node_modules', 'express'));
const apiRoutes = require(path.join(BACKEND, 'src', 'routes', 'apiRoutes.js'));

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (extra !== undefined ? '  [got: ' + JSON.stringify(extra) + ']' : ''));
    console.log('  FAIL  ' + name);
  }
}
function section(title) {
  console.log('\n== ' + title + ' ==');
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';

  async function api(method, urlPath, opts) {
    opts = opts || {};
    const res = await fetch(base + urlPath, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        opts.token ? { Authorization: 'Bearer ' + opts.token } : {}
      ),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    return { status: res.status, body: json };
  }

  const MATERIAL = { slug: 'intro-http', title: 'Intro to HTTP', content_summary: 'HTTP basics' };

  try {
    // -----------------------------------------------------------------
    section('T1 auth required');
    let r = await api('GET', '/review/schedule');
    check('GET /review/schedule without token -> 401', r.status === 401, r);
    r = await api('POST', '/review/result', { body: { materialSlug: 'x', correct: true } });
    check('POST /review/result without token -> 401', r.status === 401, r);
    r = await api('GET', '/diagnostic/baseline');
    check('GET /diagnostic/baseline without token -> 401', r.status === 401, r);
    r = await api('GET', '/diagnostic/improvement');
    check('GET /diagnostic/improvement without token -> 401', r.status === 401, r);

    // -----------------------------------------------------------------
    section('T2 spaced repetition: result creates + updates the row');
    r = await api('POST', '/review/result', {
      token: TOKEN_A,
      body: { materialSlug: 'intro-http', correct: true },
    });
    check('POST /review/result -> 200', r.status === 200, r);
    check('success === true', r.body && r.body.success === true, r.body);
    check('correct echoed', r.body && r.body.correct === true, r.body);
    check('schedule returned', r.body && r.body.schedule && r.body.schedule.material_slug === 'intro-http', r.body);
    check('ease starts at 2.5 then +0.1', r.body.schedule.ease_factor === 2.6, r.body.schedule);
    check('repetitions = 1', r.body.schedule.repetitions === 1, r.body.schedule);
    check('lapses = 0', r.body.schedule.lapses === 0, r.body.schedule);
    check('last_result = correct', r.body.schedule.last_result === 'correct', r.body.schedule);

    // The first correct review pushes the next review out into the future
    // (the stored interval was 0, protected by GREATEST(1, ...)), so the
    // material is no longer due.
    r = await api('GET', '/review/schedule', { token: TOKEN_A });
    check('GET /review/schedule -> 200', r.status === 200, r);
    check('schedule empty after the first correct review', r.body && r.body.items.length === 0, r.body);

    // A correct answer doubles the interval and pushes the next review out
    r = await api('POST', '/review/result', {
      token: TOKEN_A,
      body: { materialSlug: 'intro-http', correct: true },
    });
    check('second correct -> ease 2.7', r.body.schedule.ease_factor === 2.7, r.body.schedule);
    check('second correct -> repetitions 2', r.body.schedule.repetitions === 2, r.body.schedule);
    check('second correct -> interval doubled to 2', r.body.schedule.interval_days === 2, r.body.schedule);
    r = await api('GET', '/review/schedule', { token: TOKEN_A });
    check('not due anymore after correct answer', r.body.items.length === 0, r.body);

    // -----------------------------------------------------------------
    section('T3 spaced repetition: wrong answer resets the schedule');
    r = await api('POST', '/review/result', {
      token: TOKEN_A,
      body: { materialSlug: 'intro-http', correct: false },
    });
    check('wrong -> ease 2.6', r.body.schedule.ease_factor === 2.6, r.body.schedule);
    check('wrong -> repetitions reset to 1', r.body.schedule.repetitions === 1, r.body.schedule);
    check('wrong -> lapses 1', r.body.schedule.lapses === 1, r.body.schedule);
    check('wrong -> interval 1 day', r.body.schedule.interval_days === 1, r.body.schedule);
    check('wrong -> last_result incorrect', r.body.schedule.last_result === 'incorrect', r.body.schedule);
    r = await api('GET', '/review/schedule', { token: TOKEN_A });
    check('not due yet (scheduled 1 day ahead after wrong)', r.body.items.length === 0, r.body);

    // -----------------------------------------------------------------
    section('T4 spaced repetition: validation + per-user isolation');
    r = await api('POST', '/review/result', { token: TOKEN_A, body: { correct: true } });
    check('missing materialSlug -> 400', r.status === 400 && typeof r.body.error === 'string', r);
    r = await api('GET', '/review/schedule', { token: TOKEN_B });
    check('other user sees no rows', r.status === 200 && r.body.items.length === 0, r.body);

    // -----------------------------------------------------------------
    section('T5 diagnostic start: pre/post tagging');
    r = await api('POST', '/quiz/diagnostic-start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL, testType: 'pre' },
    });
    check('diagnostic-start pre -> 200', r.status === 200, r);
    check('response reports testType pre', r.body && r.body.testType === 'pre', r.body);
    const preAttempt = state.attempts.find((a) => a.id === r.body.attemptId);
    check('attempt row tagged pre', preAttempt && preAttempt.test_type === 'pre', preAttempt);

    r = await api('POST', '/quiz/diagnostic-start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL, testType: 'nonsense' },
    });
    check('invalid testType -> 400', r.status === 400 && typeof r.body.error === 'string', r);
    r = await api('POST', '/quiz/diagnostic-start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL },
    });
    check('missing testType -> 400', r.status === 400, r);

    // The regular quiz start still defaults to 'assessment'
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'other-material', material: { slug: 'other-material', title: 'Other' } },
    });
    check('plain quiz/start -> 200', r.status === 200, r);
    const plainAttempt = state.attempts.find((a) => a.id === r.body.attemptId);
    check('plain quiz start tagged assessment', plainAttempt && plainAttempt.test_type === 'assessment', plainAttempt);

    // -----------------------------------------------------------------
    section('T6 submit writes the test_type onto quiz_results');
    r = await api('POST', '/quiz/' + preAttempt.id + '/submit', {
      token: TOKEN_A,
      body: {
        answers: [{ index: 0, value: 'A' }],
        keystrokes: [{ key: 'a', time: 1, type: 'keydown' }],
        pasteDetected: false,
        focusLossCount: 0,
      },
    });
    check('submit pre -> 200 graded', r.status === 200 && r.body.graded === true, r);
    const preRow = state.quizResults.find((q) => q.attempt_id === preAttempt.id);
    check('quiz_results row test_type = pre', preRow && preRow.test_type === 'pre', preRow);
    check('quiz_results row has score', preRow && typeof preRow.score === 'number', preRow);

    // -----------------------------------------------------------------
    section('T7 diagnostic baseline + improvement');
    r = await api('GET', '/diagnostic/baseline', { token: TOKEN_A });
    check('GET /diagnostic/baseline -> 200', r.status === 200, r);
    check('hasBaseline true', r.body && r.body.hasBaseline === true, r.body);
    check('baseline has pre score', typeof r.body.baseline.score === 'number', r.body.baseline);
    check('baseline testType = pre', r.body.baseline && r.body.baseline.testType === 'pre', r.body.baseline);

    r = await api('GET', '/diagnostic/improvement', { token: TOKEN_A });
    check('GET /diagnostic/improvement -> 200', r.status === 200, r);
    check('hasBaseline true', r.body && r.body.hasBaseline === true, r.body);
    check('no post test yet -> hasPostTest false', r.body.hasPostTest === false, r.body);
    check('improvement null without a post test', r.body.improvement === null, r.body);

    // Now take the post test with a worse score
    r = await api('POST', '/quiz/diagnostic-start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL, testType: 'post' },
    });
    check('diagnostic-start post -> 200', r.status === 200, r);
    const postAttempt = state.attempts.find((a) => a.id === r.body.attemptId);
    check('post attempt tagged post', postAttempt && postAttempt.test_type === 'post', postAttempt);

    // Score the post test as 50 by seeding the row directly (grading is
    // covered by the assessment smoke test).
    state.quizResults.push({
      id: state.quizResults.length + 1,
      user_id: 1,
      material_slug: 'intro-http',
      quiz_type: 'quiz',
      score: 50,
      total_questions: 2,
      correct_answers: 1,
      test_type: 'post',
      attempt_id: postAttempt.id,
      integrity_status: 'verified',
      created_at: new Date(Date.now() + 1000),
      _seq: ++state.seq,
    });

    r = await api('GET', '/diagnostic/improvement', { token: TOKEN_A });
    check('improvement -> 200', r.status === 200, r);
    check('hasPostTest true', r.body.hasPostTest === true, r.body);
    check('preScore 100', r.body.improvement && r.body.improvement.preScore === 100, r.body.improvement);
    check('postScore 50', r.body.improvement && r.body.improvement.postScore === 50, r.body.improvement);
    check('absoluteDelta -50', r.body.improvement && r.body.improvement.absoluteDelta === -50, r.body.improvement);
    check('improvementPercent -50', r.body.improvement && r.body.improvement.improvementPercent === -50, r.body.improvement);
    check('improved false', r.body.improvement && r.body.improvement.improved === false, r.body.improvement);

    // -----------------------------------------------------------------
    section('T8 diagnostic: no baseline for a fresh user');
    r = await api('GET', '/diagnostic/baseline', { token: TOKEN_B });
    check('baseline -> 200 with no data', r.status === 200 && r.body.hasBaseline === false, r.body);
    check('baseline null', r.body.baseline === null, r.body);
    r = await api('GET', '/diagnostic/improvement', { token: TOKEN_B });
    check('improvement -> 200 with no data', r.status === 200 && r.body.hasBaseline === false, r.body);
    check('improvement null', r.body.improvement === null, r.body);
  } finally {
    server.close();
  }

  console.log('\n----------------------------------------');
  console.log('PASSED: ' + passed + '   FAILED: ' + failures.length);
  if (failures.length > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('SPACED REPETITION + DIAGNOSTIC SMOKE TEST OK');
  }
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exitCode = 1;
});
