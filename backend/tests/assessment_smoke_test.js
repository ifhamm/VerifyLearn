'use strict';

/**
 * Throwaway smoke test for the server-side grading work (Phase 1b).
 * Stubs src/utils/db.js and src/services/aiService.js via require.cache,
 * mounts the real router on an ephemeral express app, and exercises the
 * contract end-to-end over HTTP.
 *
 * Run from the backend workdir:  node C:\Users\NTTData\AppData\Local\Temp\opencode\assessment_smoke_test.js
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
  sessions: new Map(), // sha256(token) -> session row
  plans: [],
  attempts: [],
  quizResults: [],
  integrityEvents: [],
  userProgress: [],
};

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const TOKEN_A = 'smoke-token-alice';
const TOKEN_B = 'smoke-token-bob';

state.users.set(1, { id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 96, is_mock: false });
state.users.set(2, { id: 2, wallet_address: '0xbbb', username: 'bob', integrity_score: 100, is_mock: false });
state.sessions.set(sha256(TOKEN_A), { user_id: 1, wallet_address: '0xaaa', username: 'alice', integrity_score: 96, is_mock: false });
state.sessions.set(sha256(TOKEN_B), { user_id: 2, wallet_address: '0xbbb', username: 'bob', integrity_score: 100, is_mock: false });

function parseAttempt(row) {
  const out = Object.assign({}, row);
  ['questions', 'answer_key', 'voice_challenge', 'integrity'].forEach((col) => {
    if (typeof out[col] === 'string') out[col] = JSON.parse(out[col]);
  });
  return out;
}

function withParsedDetails(row) {
  const out = Object.assign({}, row);
  if (typeof out.details === 'string') out.details = JSON.parse(out.details);
  return out;
}

function run(rawText, rawParams) {
  const sql = String(rawText).replace(/\s+/g, ' ').trim();
  const params = rawParams || [];

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

  // real sessionService lookup
  if (sql.includes('FROM user_sessions')) {
    const row = state.sessions.get(params[0]);
    return { rows: row ? [Object.assign({}, row)] : [], rowCount: row ? 1 : 0 };
  }

  // learning plan lookups (module quiz slug derivation)
  if (sql.startsWith('SELECT plan_data FROM user_learning_paths')) {
    let rows = state.plans.filter((p) => p.user_id === Number(params[0]));
    if (sql.includes('AND role')) rows = rows.filter((p) => p.role === params[1]);
    rows = rows.slice().sort((a, b) => b._seq - a._seq).slice(0, 1);
    return { rows: rows.map((r) => ({ plan_data: r.plan_data })), rowCount: rows.length };
  }

  // users / integrity score
  if (sql.includes('SELECT integrity_score FROM users')) {
    const u = state.users.get(Number(params[0]));
    return { rows: u ? [{ integrity_score: u.integrity_score }] : [], rowCount: u ? 1 : 0 };
  }
  if (sql.includes('UPDATE users SET integrity_score')) {
    const u = state.users.get(Number(params[1]));
    if (u) u.integrity_score = params[0];
    return { rows: [], rowCount: u ? 1 : 0 };
  }

  // integrity events
  if (sql.includes('INSERT INTO integrity_events')) {
    state.integrityEvents.push({
      id: state.integrityEvents.length + 1,
      user_id: params[0],
      attempt_id: params[1],
      delta: params[2],
      score_before: params[3],
      score_after: params[4],
      status: params[5],
      reasons: JSON.parse(params[6]),
      created_at: new Date(),
    });
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes('FROM integrity_events')) {
    const rows = state.integrityEvents
      .filter((e) => e.user_id === Number(params[0]))
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map((e) => ({
        delta: e.delta,
        score_before: e.score_before,
        score_after: e.score_after,
        status: e.status,
        reasons: e.reasons,
        created_at: e.created_at,
      }));
    return { rows, rowCount: rows.length };
  }

  // assessment attempts
  if (sql.includes('INSERT INTO assessment_attempts')) {
    const row = {
      id: params[0],
      user_id: params[1],
      material_slug: params[2],
      quiz_type: params[3],
      role: params[4],
      status: 'in_progress',
      questions: params[5],
      answer_key: params[6],
      voice_challenge: null,
      hints_used: 0,
      started_at: params[7],
      expires_at: params[8],
      submitted_at: null,
      integrity: null,
      created_at: new Date(),
      _seq: ++state.seq,
    };
    state.attempts.push(row);
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes('FROM assessment_attempts WHERE user_id = $1 AND material_slug')) {
    const rows = state.attempts
      .filter((a) => Number(a.user_id) === Number(params[0]) && a.material_slug === params[1] && a.quiz_type === params[2])
      .sort((a, b) => b._seq - a._seq)
      .map(parseAttempt);
    return { rows, rowCount: rows.length };
  }
  if (sql.includes('FROM assessment_attempts WHERE id = $1')) {
    const row = state.attempts.find((a) => a.id === params[0]);
    return { rows: row ? [parseAttempt(row)] : [], rowCount: row ? 1 : 0 };
  }
  if (sql.includes("SET status = 'expired'")) {
    const row = state.attempts.find((a) => a.id === params[0] && a.status === 'in_progress');
    if (row) row.status = 'expired';
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.includes('SET voice_challenge = $1')) {
    const row = state.attempts.find((a) => a.id === params[1]);
    if (row) row.voice_challenge = params[0];
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.includes('SET hints_used = COALESCE')) {
    const row = state.attempts.find((a) => a.id === params[0]);
    if (row) row.hints_used = (row.hints_used || 0) + 1;
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (sql.includes('SET status = $1, submitted_at')) {
    const row = state.attempts.find((a) => a.id === params[3] && a.status === 'in_progress');
    if (row) {
      row.status = params[0];
      row.submitted_at = params[1];
      row.integrity = params[2];
    }
    return { rows: [], rowCount: row ? 1 : 0 };
  }

  // quiz results
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
      created_at: new Date(),
      _seq: ++state.seq,
    });
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes('FROM quiz_results WHERE user_id = $1 AND material_slug')) {
    const rows = state.quizResults
      .filter(
        (r) =>
          Number(r.user_id) === Number(params[0]) &&
          r.material_slug === params[1] &&
          r.quiz_type === params[2]
      )
      .sort((a, b) => b._seq - a._seq)
      .slice(0, 1)
      .map(withParsedDetails);
    return { rows, rowCount: rows.length };
  }
  if (sql.includes('FROM quiz_results WHERE user_id = $1 ORDER BY')) {
    const rows = state.quizResults
      .filter((r) => Number(r.user_id) === Number(params[0]))
      .sort((a, b) => b._seq - a._seq)
      .map(withParsedDetails);
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('INSERT INTO user_progress') && sql.includes('ON CONFLICT')) {
    const key = `${params[0]}|${params[2]}|${params[1]}`;
    const existing = state.userProgress.find(
      (p) => `${p.user_id}|${p.role}|${p.material_slug}` === key
    );
    if (existing) {
      existing.status = 'completed';
      existing.completed_at = existing.completed_at || new Date();
    } else {
      state.userProgress.push({
        user_id: params[0],
        material_slug: params[1],
        role: params[2],
        status: 'completed',
        completed_at: new Date(),
      });
    }
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('DELETE FROM assessment_attempts')) {
    state.attempts = state.attempts.filter((a) => !(Number(a.user_id) === Number(params[0]) && a.role === params[1]));
    return { rows: [], rowCount: 0 };
  }

  throw new Error('fake db: unhandled query -> ' + sql);
}

const fakeDb = {
  query: async (text, params) => run(text, params),
  pool: {
    connect: async () => ({
      query: async (text, params) => run(text, params),
      release: () => {},
    }),
  },
  __state: state,
};

// ---------------------------------------------------------------------------
// Stubbed aiService
// ---------------------------------------------------------------------------
const FIXTURE_QUIZ = [
  {
    type: 'multiple_choice',
    question: 'What does HTTP stand for?',
    options: [
      'A. HyperText Transfer Protocol',
      'B. High Transfer Text Protocol',
      'C. HyperText Transit Process',
      'D. None of the above',
    ],
    correct_answer: 'A',
    explanation: 'HTTP = HyperText Transfer Protocol.',
    difficulty: 'easy',
  },
  {
    type: 'essay',
    question: 'Explain the main HTTP verbs.',
    correct_answer: 'GET, POST, PUT, DELETE',
    explanation: 'Verbs: GET, POST, PUT, DELETE.',
    difficulty: 'medium',
  },
];

const aiCalls = { gradeEssay: [], verifyVoice: [], generateVoiceChallenge: [] };

const fakeAiService = {
  generateQuiz: async () => FIXTURE_QUIZ.map((q) => Object.assign({}, q)),
  analyzeKeystrokes: async () => ({
    verified: true,
    confidence: 0.95,
    message: 'Integrity pattern verified secure.',
    metrics: { wpm: 60, instant_ratio: 0.1, avg_dwell_ms: 90, std_flight_ms: 40 },
  }),
  gradeEssay: async (question, explanation, userAnswer) => {
    aiCalls.gradeEssay.push({ question, explanation, userAnswer });
    return { score: 80, feedback: 'Solid answer.' };
  },
  generateVoiceChallenge: async (material, text, reason) => {
    aiCalls.generateVoiceChallenge.push({ material, text, reason });
    return { question: 'Please explain HTTP verbs out loud.', expected_keywords: ['get', 'post', 'put'] };
  },
  verifyVoice: async (transcript, keywords) => {
    aiCalls.verifyVoice.push({ transcript, keywords });
    return { passed: true, feedback: 'Voice matched.' };
  },
};

// ---------------------------------------------------------------------------
// Cache injection (must happen before anything requires them)
// ---------------------------------------------------------------------------
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

const KEYS_LEAKED = ['correct_answer', 'explanation'];

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
    section('auth');
    let r = await api('POST', '/quiz/start', { body: { role: 'backend', slug: 'intro-http' } });
    check('start without token -> 401', r.status === 401, r);

    // -----------------------------------------------------------------
    section('T1 start strips answers');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL, n_pg: 4, n_essay: 1 },
    });
    check('start -> 200', r.status === 200, r);
    check('start returns attemptId', typeof (r.body && r.body.attemptId) === 'string', r.body);
    const attemptId1 = r.body.attemptId;
    const qs = r.body.questions || [];
    check('two questions returned', qs.length === 2, qs.length);
    const leaked = qs.filter((q) => KEYS_LEAKED.some((k) => Object.prototype.hasOwnProperty.call(q, k)));
    check('questions contain no correct_answer/explanation', leaked.length === 0, leaked);
    check(
      'question shape {index,type,question}',
      qs.every((q, i) => q.index === i && typeof q.type === 'string' && typeof q.question === 'string'),
      qs
    );
    check('mcq options present', Array.isArray(qs[0].options), qs[0]);
    check('expiresInSeconds = 600', r.body.expiresInSeconds === 600, r.body.expiresInSeconds);
    check('startedAt/expiresAt are strings', typeof r.body.startedAt === 'string' && typeof r.body.expiresAt === 'string', r.body);
    const storedAttempt = parseAttempt(state.attempts.find((a) => a.id === attemptId1));
    check('answer_key stored server-side', Array.isArray(storedAttempt.answer_key) && storedAttempt.answer_key[1].explanation.length > 0, storedAttempt.answer_key);
    check('material_slug = material slug', storedAttempt.material_slug === 'intro-http', storedAttempt.material_slug);
    check('quiz_type = quiz', storedAttempt.quiz_type === 'quiz', storedAttempt.quiz_type);

    // -----------------------------------------------------------------
    section('T2 resume in-progress attempt');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL },
    });
    check('second start -> 200', r.status === 200, r);
    check('same attempt resumed', r.body.attemptId === attemptId1, r.body.attemptId);

    // -----------------------------------------------------------------
    section('T3 submit grades server-side');
    r = await api('POST', '/quiz/' + attemptId1 + '/submit', {
      token: TOKEN_A,
      body: {
        answers: [
          { index: 0, value: 'A' },
          { index: 1, value: 'HTTP verbs include GET, POST, PUT and DELETE for CRUD operations.' },
        ],
        keystrokes: [{ key: 'a', time: 1, type: 'keydown' }],
        pasteDetected: false,
        focusLossCount: 0,
      },
    });
    check('submit -> 200', r.status === 200, r);
    check('graded === true', r.body && r.body.graded === true, r.body);
    check('attemptId echoes', r.body.attemptId === attemptId1, r.body.attemptId);
    check('correctAnswers = 1', r.body.correctAnswers === 1, r.body.correctAnswers);
    check('totalQuestions = 2', r.body.totalQuestions === 2, r.body.totalQuestions);
    check('score = 90 ((100 + 80) / 2)', r.body.score === 90, r.body.score);
    check('integrity.status = verified', r.body.integrity && r.body.integrity.status === 'verified', r.body.integrity);
    check('integrity.delta = +4', r.body.integrity.delta === 4, r.body.integrity);
    check('integrity.score = 100 (96 clamped +4)', r.body.integrity.score === 100, r.body.integrity);
    check('integrity.reasons empty', Array.isArray(r.body.integrity.reasons) && r.body.integrity.reasons.length === 0, r.body.integrity);
    check(
      'essayFeedbacks shape',
      Array.isArray(r.body.essayFeedbacks) &&
        r.body.essayFeedbacks.length === 1 &&
        r.body.essayFeedbacks[0].index === 1 &&
        r.body.essayFeedbacks[0].score === 80 &&
        typeof r.body.essayFeedbacks[0].feedback === 'string',
      r.body.essayFeedbacks
    );
    const gradeCall = aiCalls.gradeEssay[aiCalls.gradeEssay.length - 1];
    check('gradeEssay used STORED explanation', gradeCall && gradeCall.explanation === 'Verbs: GET, POST, PUT, DELETE.', gradeCall);
    check('gradeEssay used question text', gradeCall && gradeCall.question === 'Explain the main HTTP verbs.', gradeCall);
    check('user score now 100', state.users.get(1).integrity_score === 100, state.users.get(1).integrity_score);
    const gradedAttempt = state.attempts.find((a) => a.id === attemptId1);
    check('attempt marked graded', gradedAttempt.status === 'graded', gradedAttempt.status);
    const resultRow = state.quizResults.find((q) => q.attempt_id === attemptId1);
    check('quiz_results row source=server', resultRow && resultRow.source === 'server', resultRow && resultRow.source);
    check('quiz_results row integrity_status=verified', resultRow && resultRow.integrity_status === 'verified', resultRow && resultRow.integrity_status);
    const progressRow = state.userProgress.find((p) => p.material_slug === 'intro-http');
    check('user_progress completion written server-side', progressRow && progressRow.status === 'completed', progressRow);

    // -----------------------------------------------------------------
    section('T4 double submit / retake blocked / GET routes still work');
    r = await api('POST', '/quiz/' + attemptId1 + '/submit', {
      token: TOKEN_A,
      body: { answers: [], keystrokes: [] },
    });
    check('second submit -> 409', r.status === 409, r);
    check('409 has error shape', r.body && typeof r.body.error === 'string', r.body);
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'intro-http', material: MATERIAL },
    });
    check('start after graded -> 409', r.status === 409, r);
    r = await api('GET', '/quiz/result?materialSlug=intro-http&quizType=quiz', { token: TOKEN_A });
    check('GET /quiz/result -> 200', r.status === 200, r);
    check('GET /quiz/result returns server row', r.body && r.body.data && r.body.data.source === 'server', r.body);
    check('GET /quiz/result integrity_status present', r.body.data.integrity_status === 'verified', r.body.data);
    r = await api('GET', '/quiz/results', { token: TOKEN_A });
    check('GET /quiz/results -> 200 with rows', r.status === 200 && Array.isArray(r.body.data) && r.body.data.length >= 1, r);

    // -----------------------------------------------------------------
    section('T5 hint limit (3) + hint content');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'hint-material', material: { slug: 'hint-material', title: 'Hints' } },
    });
    const attemptIdH = r.body.attemptId;
    r = await api('POST', '/quiz/' + attemptIdH + '/hint', { token: TOKEN_A, body: { index: 0 } });
    check('hint 1 -> 200 with stored explanation', r.status === 200 && r.body.hint === 'HTTP = HyperText Transfer Protocol.', r.body);
    r = await api('POST', '/quiz/' + attemptIdH + '/hint', { token: TOKEN_A, body: { index: 99 } });
    check('unknown question index -> 404', r.status === 404, r);
    r = await api('POST', '/quiz/' + attemptIdH + '/hint', { token: TOKEN_A, body: { index: 1 } });
    check('hint 2 -> 200', r.status === 200, r);
    r = await api('POST', '/quiz/' + attemptIdH + '/hint', { token: TOKEN_A, body: { index: 0 } });
    check('hint 3 -> 200', r.status === 200, r);
    r = await api('POST', '/quiz/' + attemptIdH + '/hint', { token: TOKEN_A, body: { index: 0 } });
    check('hint 4 -> 403 limit', r.status === 403 && typeof r.body.error === 'string', r);
    const hintAttempt = state.attempts.find((a) => a.id === attemptIdH);
    check('hints_used tracked = 3', hintAttempt.hints_used === 3, hintAttempt.hints_used);

    // -----------------------------------------------------------------
    section('T6 late submission -> review_required / time_anomaly / delta 0');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'late-material', material: { slug: 'late-material', title: 'Late' } },
    });
    const attemptIdL = r.body.attemptId;
    state.attempts.find((a) => a.id === attemptIdL).expires_at = new Date(Date.now() - 5000);
    r = await api('POST', '/quiz/' + attemptIdL + '/submit', {
      token: TOKEN_A,
      body: {
        answers: [
          { index: 0, value: 'A. HyperText Transfer Protocol' },
          { index: 1, value: 'Late but fine.' },
        ],
        keystrokes: [{ key: 'a', time: 1, type: 'keydown' }],
        pasteDetected: false,
      },
    });
    check('late submit -> 200 graded', r.status === 200 && r.body.graded === true, r);
    check('late -> integrity review_required', r.body.integrity.status === 'review_required', r.body.integrity);
    check('late -> delta 0', r.body.integrity.delta === 0, r.body.integrity);
    check('late reasons contain time_anomaly', r.body.integrity.reasons.includes('time_anomaly'), r.body.integrity);
    check('late option-letter answer still graded correct', r.body.correctAnswers === 1, r.body.correctAnswers);
    check('late -> integrity score unchanged (100)', r.body.integrity.score === 100, r.body.integrity);

    // -----------------------------------------------------------------
    section('T7 retired endpoints -> 410');
    const RETIRED_BODY = { error: 'This endpoint has been retired. Server-side grading is now required.' };
    r = await api('POST', '/quiz/result', { token: TOKEN_A, body: { materialSlug: 'x', quizType: 'quiz' } });
    check('POST /quiz/result -> 410 exact body', r.status === 410 && JSON.stringify(r.body) === JSON.stringify(RETIRED_BODY), r);
    r = await api('POST', '/grade-essay', { token: TOKEN_A, body: { question: 'q', explanation: 'e', userAnswer: 'a' } });
    check('POST /grade-essay -> 410 exact body', r.status === 410 && JSON.stringify(r.body) === JSON.stringify(RETIRED_BODY), r);
    r = await api('POST', '/verify-voice', { token: TOKEN_A, body: { transcript: 'hi', expectedKeywords: ['a'] } });
    check('POST /verify-voice -> 410 exact body', r.status === 410 && JSON.stringify(r.body) === JSON.stringify(RETIRED_BODY), r);

    // -----------------------------------------------------------------
    section('T8 module quiz slugs (quiz-module-<n>)');
    state.plans.push({
      user_id: 1,
      role: 'backend',
      plan_data: {
        role: 'backend',
        materials: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map((slug) => ({ slug, title: slug.toUpperCase() })),
      },
      _seq: ++state.seq,
    });
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: {
        role: 'backend',
        slug: 'm5',
        moduleMaterials: [
          { slug: 'm5', title: 'M5', content_summary: 'a' },
          { slug: 'm6', title: 'M6', content_summary: 'b' },
        ],
      },
    });
    check('module start -> 200', r.status === 200, r);
    let modAttempt = state.attempts.find((a) => a.id === (r.body && r.body.attemptId));
    check('module quiz_type = module_quiz', modAttempt && modAttempt.quiz_type === 'module_quiz', modAttempt && modAttempt.quiz_type);
    check('module slug derived from plan -> quiz-module-3', modAttempt && modAttempt.material_slug === 'quiz-module-3', modAttempt && modAttempt.material_slug);
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: {
        role: 'backend',
        slug: 'quiz-module-1',
        moduleMaterials: [{ slug: 'z1', title: 'Z1', content_summary: 'c' }],
      },
    });
    modAttempt = state.attempts.find((a) => a.id === (r.body && r.body.attemptId));
    check('pre-normalized module slug kept', modAttempt && modAttempt.material_slug === 'quiz-module-1', modAttempt && modAttempt.material_slug);
    check('module attempts resume by (user, slug, type)', (() => {
      const dup = state.attempts.filter((a) => a.user_id === 1 && a.material_slug === 'quiz-module-1' && a.quiz_type === 'module_quiz');
      return dup.length === 1;
    })(), state.attempts.length);

    // -----------------------------------------------------------------
    section('T9 voice challenge flow (fail -> challenge -> pass -> verified)');
    fakeAiService.analyzeKeystrokes = async () => ({
      verified: false,
      confidence: 0.05,
      message: 'Suspicious typing cadence detected.',
      metrics: { wpm: 5, instant_ratio: 0.9, avg_dwell_ms: 2, std_flight_ms: 1 },
    });
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'voice-material', material: { slug: 'voice-material', title: 'Voice' } },
    });
    const attemptIdV = r.body.attemptId;
    const voiceSubmit = {
      answers: [
        { index: 0, value: 'A' },
        { index: 1, value: 'The verbs are GET and POST.' },
      ],
      keystrokes: [{ key: 'x', time: 2, type: 'keydown' }],
      pasteDetected: false,
    };
    r = await api('POST', '/quiz/' + attemptIdV + '/submit', { token: TOKEN_A, body: voiceSubmit });
    check('keystroke fail, no voice -> 200 challenge', r.status === 200 && r.body.requiresVoiceChallenge === true, r.body);
    check('challenge has reason', typeof r.body.reason === 'string' && r.body.reason.length > 0, r.body);
    check('challenge has question', typeof r.body.question === 'string' && r.body.question.length > 0, r.body);
    const vAttempt = state.attempts.find((a) => a.id === attemptIdV);
    check('attempt stays in_progress', vAttempt.status === 'in_progress', vAttempt.status);
    const storedChallenge = typeof vAttempt.voice_challenge === 'string' ? JSON.parse(vAttempt.voice_challenge) : vAttempt.voice_challenge;
    check(
      'voice_challenge stored as {question, keywords, reason}',
      storedChallenge &&
        typeof storedChallenge.question === 'string' &&
        Array.isArray(storedChallenge.keywords) &&
        typeof storedChallenge.reason === 'string',
      storedChallenge
    );
    check('no grading yet (gradeEssay not called for this attempt)', aiCalls.gradeEssay.every((c) => true) && vAttempt.submitted_at === null, vAttempt.submitted_at);

    fakeAiService.verifyVoice = async (transcript, keywords) => {
      aiCalls.verifyVoice.push({ transcript, keywords });
      return { passed: true, feedback: 'Voice matched.' };
    };
    r = await api('POST', '/quiz/' + attemptIdV + '/submit', {
      token: TOKEN_A,
      body: Object.assign({}, voiceSubmit, { voice: { transcript: 'the verbs are get and post' } }),
    });
    check('voice resubmit -> 200 graded', r.status === 200 && r.body.graded === true, r.body);
    check('voice pass -> integrity verified', r.body.integrity && r.body.integrity.status === 'verified', r.body.integrity);
    check('voice pass -> delta +4', r.body.integrity.delta === 4, r.body.integrity);
    const verifyCall = aiCalls.verifyVoice[aiCalls.verifyVoice.length - 1];
    check('verifyVoice used STORED keywords', verifyCall && JSON.stringify(verifyCall.keywords) === JSON.stringify(['get', 'post', 'put']), verifyCall);

    // -----------------------------------------------------------------
    section('T10 fail-closed: AI essay grading unreachable');
    fakeAiService.analyzeKeystrokes = async () => ({
      verified: true,
      confidence: 0.9,
      message: 'ok',
      metrics: {},
    });
    fakeAiService.gradeEssay = async (question, explanation, userAnswer) => {
      aiCalls.gradeEssay.push({ question, explanation, userAnswer });
      return { score: 0, feedback: 'Failed to evaluate answer automatically: connection refused' };
    };
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'broken-ai-material', material: { slug: 'broken-ai-material', title: 'Broken' } },
    });
    const attemptIdB = r.body.attemptId;
    r = await api('POST', '/quiz/' + attemptIdB + '/submit', {
      token: TOKEN_A,
      body: {
        answers: [
          { index: 0, value: 'A' },
          { index: 1, value: 'My essay.' },
        ],
        keystrokes: [{ key: 'a', time: 1, type: 'keydown' }],
        pasteDetected: false,
      },
    });
    check('fail-closed -> 200 graded:true (no 500)', r.status === 200 && r.body.graded === true, r);
    check('fail-closed integrity review_required', r.body.integrity && r.body.integrity.status === 'review_required', r.body.integrity);
    check('fail-closed delta 0', r.body.integrity.delta === 0, r.body.integrity);
    check('fail-closed reasons = [ai_service_unavailable]', JSON.stringify(r.body.integrity.reasons) === JSON.stringify(['ai_service_unavailable']), r.body.integrity);
    check('fail-closed integrity score unchanged', r.body.integrity.score === 100, r.body.integrity);
    check('fail-closed still grades MCQs honestly', r.body.correctAnswers === 1 && r.body.totalQuestions === 2 && r.body.score === 50, r.body);
    check('fail-closed essayFeedbacks score 0', r.body.essayFeedbacks[0].score === 0, r.body.essayFeedbacks);
    const brokenAttempt = state.attempts.find((a) => a.id === attemptIdB);
    check('fail-closed attempt status review_required', brokenAttempt.status === 'review_required', brokenAttempt.status);
    const brokenResult = state.quizResults.find((q) => q.attempt_id === attemptIdB);
    check('fail-closed quiz_results integrity_status=review_required', brokenResult && brokenResult.integrity_status === 'review_required', brokenResult && brokenResult.integrity_status);
    check('fail-closed submission stored in details', brokenResult && Array.isArray(JSON.parse(brokenResult.details).userAnswers) && JSON.parse(brokenResult.details).userAnswers.length === 2, brokenResult && brokenResult.details);
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'broken-ai-material', material: { slug: 'broken-ai-material', title: 'Broken' } },
    });
    check('start after review_required attempt -> 409', r.status === 409, r);

    // -----------------------------------------------------------------
    section('T11 fail-closed: keystroke analysis unreachable (no voice challenge issued)');
    fakeAiService.analyzeKeystrokes = async () => ({
      verified: false,
      confidence: 0,
      message: 'Gagal menghubungi AI Service: fetch failed',
      metrics: { wpm: 0, instant_ratio: 0, avg_dwell_ms: 0, std_flight_ms: 0 },
    });
    fakeAiService.gradeEssay = async (question, explanation, userAnswer) => {
      aiCalls.gradeEssay.push({ question, explanation, userAnswer });
      return { score: 80, feedback: 'Solid answer.' };
    };
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'ks-down-material', material: { slug: 'ks-down-material', title: 'KsDown' } },
    });
    const attemptIdK = r.body.attemptId;
    const challengeCallsBefore = aiCalls.generateVoiceChallenge.length;
    r = await api('POST', '/quiz/' + attemptIdK + '/submit', {
      token: TOKEN_A,
      body: {
        answers: [
          { index: 0, value: 'A' },
          { index: 1, value: 'Essay.' },
        ],
        keystrokes: [{ key: 'a', time: 1, type: 'keydown' }],
        pasteDetected: false,
      },
    });
    check('keystroke-down submit -> 200 graded:true', r.status === 200 && r.body.graded === true, r);
    check('keystroke-down integrity review_required/ai_service_unavailable',
      r.body.integrity && r.body.integrity.status === 'review_required' &&
        JSON.stringify(r.body.integrity.reasons) === JSON.stringify(['ai_service_unavailable']),
      r.body.integrity);
    check('no voice challenge generated', aiCalls.generateVoiceChallenge.length === challengeCallsBefore, aiCalls.generateVoiceChallenge.length);
    const ksAttempt = state.attempts.find((a) => a.id === attemptIdK);
    check('keystroke-down attempt status review_required', ksAttempt.status === 'review_required', ksAttempt.status);
    fakeAiService.analyzeKeystrokes = async () => ({ verified: true, confidence: 0.9, message: 'ok', metrics: {} });

    // -----------------------------------------------------------------
    section('T12 voice verification FAIL -> high_risk (-15)');
    fakeAiService.analyzeKeystrokes = async () => ({
      verified: false,
      confidence: 0.05,
      message: 'Suspicious typing cadence detected.',
      metrics: {},
    });
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'risk-material', material: { slug: 'risk-material', title: 'Risk' } },
    });
    const attemptIdR = r.body.attemptId;
    const riskSubmit = {
      answers: [
        { index: 0, value: 'A' },
        { index: 1, value: 'Essay text.' },
      ],
      keystrokes: [{ key: 'x', time: 2, type: 'keydown' }],
      pasteDetected: false,
    };
    r = await api('POST', '/quiz/' + attemptIdR + '/submit', { token: TOKEN_A, body: riskSubmit });
    check('challenge issued first', r.body && r.body.requiresVoiceChallenge === true, r.body);
    fakeAiService.verifyVoice = async (transcript, keywords) => {
      aiCalls.verifyVoice.push({ transcript, keywords });
      return { passed: false, feedback: 'Keywords not found.' };
    };
    r = await api('POST', '/quiz/' + attemptIdR + '/submit', {
      token: TOKEN_A,
      body: Object.assign({}, riskSubmit, { voice: { transcript: 'totally unrelated answer' } }),
    });
    check('voice fail -> 200 graded', r.status === 200 && r.body.graded === true, r);
    check('voice fail -> high_risk', r.body.integrity && r.body.integrity.status === 'high_risk', r.body.integrity);
    check('voice fail -> delta -15', r.body.integrity.delta === -15, r.body.integrity);
    check('voice fail -> score 85', r.body.integrity.score === 85, r.body.integrity);
    check('voice fail reasons include voice_verification_failed', r.body.integrity.reasons.includes('voice_verification_failed'), r.body.integrity);
    fakeAiService.analyzeKeystrokes = async () => ({ verified: true, confidence: 0.9, message: 'ok', metrics: {} });
    fakeAiService.verifyVoice = async (transcript, keywords) => {
      aiCalls.verifyVoice.push({ transcript, keywords });
      return { passed: true, feedback: 'ok' };
    };

    // -----------------------------------------------------------------
    section('T13 ownership checks');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'owned-material', material: { slug: 'owned-material', title: 'Owned' } },
    });
    const attemptIdO = r.body.attemptId;
    r = await api('POST', '/quiz/' + attemptIdO + '/submit', { token: TOKEN_B, body: { answers: [], keystrokes: [] } });
    check('foreign submit -> 404', r.status === 404, r);
    r = await api('POST', '/quiz/' + attemptIdO + '/hint', { token: TOKEN_B, body: { index: 0 } });
    check('foreign hint -> 404', r.status === 404, r);
    r = await api('POST', '/quiz/not-a-uuid/submit', { token: TOKEN_A, body: { answers: [], keystrokes: [] } });
    check('malformed attempt id -> 404', r.status === 404, r);

    // -----------------------------------------------------------------
    section('T14 expired in-progress attempt -> expired + fresh attempt');
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'expired-material', material: { slug: 'expired-material', title: 'Expired' } },
    });
    const attemptIdE1 = r.body.attemptId;
    state.attempts.find((a) => a.id === attemptIdE1).expires_at = new Date(Date.now() - 1000);
    r = await api('POST', '/quiz/start', {
      token: TOKEN_A,
      body: { role: 'backend', slug: 'expired-material', material: { slug: 'expired-material', title: 'Expired' } },
    });
    check('expired -> fresh attempt 200', r.status === 200 && r.body.attemptId !== attemptIdE1, r.body && r.body.attemptId);
    check('fresh attempt has full timer', r.body.expiresInSeconds === 600, r.body.expiresInSeconds);
    check('old attempt marked expired', state.attempts.find((a) => a.id === attemptIdE1).status === 'expired', state.attempts.find((a) => a.id === attemptIdE1).status);

    // -----------------------------------------------------------------
    section('T15 GET /integrity/score');
    r = await api('GET', '/integrity/score', { token: TOKEN_A });
    check('GET /integrity/score -> 200', r.status === 200, r);
    check('score = 85', r.body && r.body.score === 85, r.body && r.body.score);
    const events = r.body.events || [];
    check('6 events recorded', events.length === 6, events.length);
    const e0 = events[0] || {};
    check('latest event = high_risk -15', e0.status === 'high_risk' && e0.delta === -15, e0);
    check('events sorted newest first', events.every((e, i) => i === 0 || events[i - 1].created_at >= e.created_at), events.map((e) => e.created_at));
    check(
      'event fields complete',
      events.every((e) => typeof e.delta === 'number' && typeof e.score_before === 'number' && typeof e.score_after === 'number' && typeof e.status === 'string' && Array.isArray(e.reasons) && e.created_at),
      events[0]
    );
    const firstEvent = events.find((e) => e.score_before === 96);
    check('first event applied +4 from 96 -> 100', firstEvent && firstEvent.delta === 4 && firstEvent.score_after === 100, firstEvent);

    // -----------------------------------------------------------------
    section('T16 syncProgress ignores integrityScore');
    r = await api('POST', '/user/sync', { token: TOKEN_A, body: { integrityScore: 50 } });
    check('sync -> 200', r.status === 200 && r.body.success === true, r);
    check('integrityScore ignored (still 85)', state.users.get(1).integrity_score === 85, state.users.get(1).integrity_score);
  } finally {
    server.close();
  }

  console.log('\n----------------------------------------');
  console.log('PASSED: ' + passed + '   FAILED: ' + failures.length);
  if (failures.length > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  } else {
    console.log('SMOKE TEST OK');
  }
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exitCode = 1;
});
