const crypto = require('crypto');
const db = require('../utils/db');
const aiService = require('../services/aiService');
const { resolveMaterial } = require('../services/materialResolver');
const integEngine = require('../services/integrityEngine');
const metricsCalculator = require('../utils/metricsCalculator');

const ATTEMPT_TTL_SECONDS = 600;
const HINT_LIMIT = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE_SLUGS = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];

// Marker used by aiService.analyzeKeystrokes when the AI engine is unreachable
const KEYSTROKE_UNREACHABLE_MARKER = 'Gagal menghubungi AI Service';
// Marker used by aiService.gradeEssay when the AI engine is unreachable
const ESSAY_UNREACHABLE_MARKER = 'Failed to evaluate answer automatically';

// Build the combined material used to generate a module quiz
// (same shape aiController.generateQuiz builds from moduleMaterials)
const buildModuleMaterial = (role, slug, moduleMaterials) => {
  const titles = moduleMaterials.map((m) => m.title).join(', ');
  const summaries = moduleMaterials.map((m) => `[${m.title}] ${m.content_summary || ''}`).join('\n');
  return {
    id: 'module-quiz',
    slug: slug || moduleMaterials[0].slug,
    title: `Module Quiz (${titles})`,
    role: role || 'backend',
    topic_type: 'module_quiz',
    parent_topic: '',
    content_summary: summaries.slice(0, 600),
  };
};

// Canonical material slug for an attempt. Module quizzes are keyed by
// `quiz-module-<n>` (exactly how quiz.js keys them), everything else by the
// material slug itself. Best effort — never throws, falls back to the raw slug.
const resolveAttemptSlug = async (userId, role, slug, isModuleQuiz, moduleMaterials) => {
  if (!isModuleQuiz) return slug;

  const preMatch = /^quiz-module-(\d+)$/.exec(String(slug || '').trim());
  if (preMatch) return `quiz-module-${preMatch[1]}`;

  try {
    let planRows = [];
    if (role) {
      const rolePlan = await db.query(
        `SELECT plan_data FROM user_learning_paths WHERE user_id = $1 AND role = $2 ORDER BY updated_at DESC LIMIT 1`,
        [userId, role]
      );
      planRows = rolePlan.rows;
    }
    if (planRows.length === 0) {
      const anyPlan = await db.query(
        `SELECT plan_data FROM user_learning_paths WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );
      planRows = anyPlan.rows;
    }

    let plan = planRows.length > 0 ? planRows[0].plan_data : null;
    if (typeof plan === 'string') {
      try {
        plan = JSON.parse(plan);
      } catch (parseError) {
        plan = null;
      }
    }
    if (!plan || !Array.isArray(plan.materials) || plan.materials.length === 0) return slug;

    // Reproduce the client-side module grouping (same chunking as quiz.js /
    // dashboard.js) and find which module contains this plan's materials.
    const variants = [null, ...LANGUAGE_SLUGS];
    for (const selectedLang of variants) {
      const filtered = plan.materials.filter((m) => {
        if (!m) return false;
        if (m.status === 'dilewati') return false;
        if (selectedLang && LANGUAGE_SLUGS.includes(m.slug) && m.slug !== selectedLang) return false;
        return true;
      });
      if (filtered.length === 0) continue;

      const chunkSize = Math.ceil(filtered.length / 4);
      const chunks = [
        filtered.slice(0, chunkSize),
        filtered.slice(chunkSize, 2 * chunkSize),
        filtered.slice(2 * chunkSize, 3 * chunkSize),
        filtered.slice(3 * chunkSize),
      ];

      const wanted = Array.from(
        new Set(
          (Array.isArray(moduleMaterials) ? moduleMaterials : [])
            .map((m) => (m ? m.slug : null))
            .filter(Boolean)
        )
      );
      if (wanted.length === 0) return slug;

      for (let i = 0; i < chunks.length; i++) {
        const chunkSlugs = new Set(chunks[i].map((m) => m.slug));
        if (wanted.every((s) => chunkSlugs.has(s))) {
          return `quiz-module-${i + 1}`;
        }
      }
    }
    return slug;
  } catch (error) {
    console.error('Error deriving module quiz slug, falling back to raw slug:', error);
    return slug;
  }
};

// Material context handed to the AI service for server-generated voice challenges
const materialForAttempt = (attempt) => {
  try {
    return resolveMaterial(attempt.role, attempt.material_slug, null);
  } catch (error) {
    return {
      id: attempt.material_slug,
      slug: attempt.material_slug,
      title: attempt.material_slug,
      role: attempt.role,
      topic_type: attempt.quiz_type === 'module_quiz' ? 'module_quiz' : 'quiz',
      parent_topic: '',
      content_summary: '',
    };
  }
};

const buildStartResponse = (attempt, nowMs) => {
  const startedAt = new Date(attempt.started_at);
  const expiresAt = new Date(attempt.expires_at);
  return {
    attemptId: attempt.id,
    questions: Array.isArray(attempt.questions) ? attempt.questions : [],
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 1000)),
  };
};

// Normalize an MCQ answer for comparison: answers may arrive as an option
// letter ("A"), a prefixed option ("A. HyperText..."), or raw option text.
const letterOf = (value) => {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!s) return null;
  const prefixed = /^([A-Za-z])\s*[).:\-]/.exec(s);
  if (prefixed) return prefixed[1].toUpperCase();
  if (s.length === 1 && /[A-Za-z]/.test(s)) return s.toUpperCase();
  return null;
};

const optionBody = (value) =>
  String(value === undefined || value === null ? '' : value)
    .replace(/^\s*[A-Za-z]\s*[).:]\s*/, '')
    .trim();

const mcqMatches = (given, correct, options) => {
  const g = String(given === undefined || given === null ? '' : given).trim();
  const c = String(correct === undefined || correct === null ? '' : correct).trim();
  if (!g || !c) return false;
  if (g === c) return true;

  const gl = letterOf(g);
  const cl = letterOf(c);
  if (gl && cl) return gl === cl;

  if (gl && Array.isArray(options)) {
    const optIndex = gl.charCodeAt(0) - 65;
    if (optIndex >= 0 && optIndex < options.length) {
      const body = optionBody(options[optIndex]);
      return body === c || String(options[optIndex]).trim() === c;
    }
    return false;
  }

  if (cl && Array.isArray(options)) {
    const optIndex = cl.charCodeAt(0) - 65;
    if (optIndex >= 0 && optIndex < options.length) {
      return optionBody(options[optIndex]) === g;
    }
    return false;
  }

  return false;
};

// POST /api/v1/quiz/start
exports.start = async (req, res) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};
    const { role, slug, material, moduleMaterials, n_pg, n_essay } = body;

    if (!slug) {
      return res.status(400).json({ error: 'slug is required.' });
    }

    const isModuleQuiz = Array.isArray(moduleMaterials) && moduleMaterials.length > 0;
    const quizType = isModuleQuiz ? 'module_quiz' : 'quiz';
    const materialSlug = await resolveAttemptSlug(userId, role, slug, isModuleQuiz, moduleMaterials);

    // A finished attempt (graded or pending review) blocks retakes — the
    // frontend checks previous results separately.
    const existingRes = await db.query(
      `SELECT * FROM assessment_attempts
       WHERE user_id = $1 AND material_slug = $2 AND quiz_type = $3
       ORDER BY created_at DESC`,
      [userId, materialSlug, quizType]
    );
    const existing = existingRes.rows || [];

    const finished = existing.find(
      (a) => a.status === 'graded' || a.status === 'review_required'
    );
    if (finished) {
      return res.status(409).json({ error: 'You have already completed this quiz.' });
    }

    const nowMs = Date.now();
    const inProgress = existing.find((a) => a.status === 'in_progress');
    if (inProgress) {
      if (new Date(inProgress.expires_at).getTime() > nowMs) {
        // Resume the still-valid attempt
        return res.json(buildStartResponse(inProgress, nowMs));
      }
      // Ran out of time before submitting — expire it, then issue a fresh attempt
      await db.query(
        `UPDATE assessment_attempts SET status = 'expired' WHERE id = $1 AND status = 'in_progress'`,
        [inProgress.id]
      );
    }

    // Resolve the material used for generation
    let resolvedMaterial;
    if (isModuleQuiz) {
      resolvedMaterial = buildModuleMaterial(role, slug, moduleMaterials);
    } else {
      try {
        resolvedMaterial = resolveMaterial(role, slug, material);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    let generated;
    try {
      generated = await aiService.generateQuiz(resolvedMaterial, n_pg, n_essay);
    } catch (err) {
      console.error('Error generating quiz for attempt:', err);
      return res.status(500).json({ error: 'Failed to generate quiz. Please try again.' });
    }

    const rawQuestions = Array.isArray(generated) ? generated : [];
    if (rawQuestions.length === 0) {
      return res.status(500).json({ error: 'Failed to generate quiz. Please try again.' });
    }

    // Split into safe questions (client-facing) and the stored answer key
    const safeQuestions = [];
    const answerKey = [];
    rawQuestions.forEach((q, index) => {
      const source = q || {};
      const type = source.type || 'multiple_choice';
      const safe = { index, type, question: source.question || '' };
      if (Array.isArray(source.options)) safe.options = source.options;
      if (source.difficulty !== undefined) safe.difficulty = source.difficulty;
      safeQuestions.push(safe);
      answerKey.push({
        index,
        type,
        correct_answer: source.correct_answer !== undefined ? source.correct_answer : null,
        explanation: source.explanation || '',
      });
    });

    const attemptId = crypto.randomUUID();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + ATTEMPT_TTL_SECONDS * 1000);
    const attemptRole = role || (resolvedMaterial && resolvedMaterial.role) || 'backend';

    await db.query(
      `INSERT INTO assessment_attempts
         (id, user_id, material_slug, quiz_type, role, status, questions, answer_key, started_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'in_progress', $6, $7, $8, $9)`,
      [
        attemptId,
        userId,
        materialSlug,
        quizType,
        attemptRole,
        JSON.stringify(safeQuestions),
        JSON.stringify(answerKey),
        startedAt,
        expiresAt,
      ]
    );

    res.json({
      attemptId,
      questions: safeQuestions,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: ATTEMPT_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Error starting quiz attempt:', error);
    res.status(500).json({ error: 'Failed to start the quiz attempt.' });
  }
};

// POST /api/v1/quiz/:attemptId/submit
exports.submit = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { attemptId } = req.params;

    if (!UUID_PATTERN.test(String(attemptId || ''))) {
      return res.status(404).json({ error: 'Assessment attempt not found.' });
    }

    const attemptRes = await db.query(
      `SELECT * FROM assessment_attempts WHERE id = $1`,
      [attemptId]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt || Number(attempt.user_id) !== Number(userId)) {
      return res.status(404).json({ error: 'Assessment attempt not found.' });
    }
    if (attempt.status !== 'in_progress') {
      return res.status(409).json({ error: 'This attempt is not accepting submissions.' });
    }

    const body = req.body || {};
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const keystrokes = Array.isArray(body.keystrokes) ? body.keystrokes : [];
    const pasteDetected = !!body.pasteDetected;
    const focusLossCount = Number(body.focusLossCount) || 0;
    const voiceTranscript =
      body.voice && typeof body.voice.transcript === 'string' ? body.voice.transcript.trim() : '';

    const nowMs = Date.now();
    const lateSubmission = nowMs > new Date(attempt.expires_at).getTime();

    const answerByIndex = new Map();
    answers.forEach((a) => {
      if (!a) return;
      const idx = Number(a.index);
      if (!Number.isFinite(idx)) return;
      answerByIndex.set(idx, a.value === undefined || a.value === null ? '' : a.value);
    });

    // ── 1. Server-side keystroke analysis ──
    let keystrokeResult = null;
    let aiUnavailable = false;
    try {
      keystrokeResult = await aiService.analyzeKeystrokes(keystrokes);
      if (!keystrokeResult || typeof keystrokeResult !== 'object') {
        aiUnavailable = true;
        keystrokeResult = null;
      } else if (
        typeof keystrokeResult.message === 'string' &&
        keystrokeResult.message.includes(KEYSTROKE_UNREACHABLE_MARKER)
      ) {
        // aiService swallowed a connection error — treat as unreachable
        aiUnavailable = true;
        keystrokeResult = null;
      }
    } catch (err) {
      console.error('Keystroke analysis failed:', err);
      aiUnavailable = true;
      keystrokeResult = null;
    }

    // ── 2. Voice challenge handling ──
    let voiceResult = null;
    if (voiceTranscript) {
      // Always verify against the STORED keywords, never a client-supplied set
      const storedChallenge = attempt.voice_challenge;
      const keywords =
        storedChallenge && Array.isArray(storedChallenge.keywords)
          ? storedChallenge.keywords
          : null;
      if (!keywords || keywords.length === 0) {
        // No stored challenge to verify against — fail closed
        voiceResult = { passed: false };
      } else {
        try {
          const vr = await aiService.verifyVoice(voiceTranscript, keywords);
          voiceResult = { passed: !!(vr && vr.passed), feedback: vr ? vr.feedback : '' };
        } catch (err) {
          console.error('Voice verification failed:', err);
          aiUnavailable = true;
        }
      }
    } else if (!aiUnavailable) {
      const keystrokeFailed = !keystrokeResult || keystrokeResult.verified !== true;
      if (keystrokeFailed) {
        // Do not grade yet: issue (or re-issue) a server-generated voice challenge
        let challenge = attempt.voice_challenge;
        if (!challenge || !challenge.question) {
          try {
            const reason =
              (keystrokeResult && keystrokeResult.message) || 'Keystroke verification failed.';
            const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
            let essayText = '';
            for (const q of questions) {
              if (q && q.type === 'essay') {
                const value = answerByIndex.get(Number(q.index));
                if (value) {
                  essayText = String(value);
                  break;
                }
              }
            }
            const data = await aiService.generateVoiceChallenge(
              materialForAttempt(attempt),
              essayText,
              reason
            );
            challenge = {
              question:
                (data && data.question) || 'Can you explain the main concept of your written answer?',
              keywords: (data && (data.keywords || data.expected_keywords)) || [],
              reason,
            };
            await db.query(
              `UPDATE assessment_attempts SET voice_challenge = $1 WHERE id = $2`,
              [JSON.stringify(challenge), attempt.id]
            );
          } catch (err) {
            console.error('Voice challenge generation failed:', err);
            aiUnavailable = true;
          }
        }
        if (!aiUnavailable) {
          return res.json({
            requiresVoiceChallenge: true,
            reason: challenge.reason,
            question: challenge.question,
          });
        }
      }
    }

    // ── 3. Server-side grading ──
    const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
    const answerKey = Array.isArray(attempt.answer_key) ? attempt.answer_key : [];
    const questionByIndex = new Map(questions.map((q) => [Number(q.index), q]));
    const sortedKey = [...answerKey].sort((a, b) => Number(a.index) - Number(b.index));

    let mcqCorrect = 0;
    let mcqTotal = 0;
    let essayScoreSum = 0;
    const essayFeedbacks = [];

    for (const entry of sortedKey) {
      const index = Number(entry.index);
      const given = answerByIndex.has(index) ? answerByIndex.get(index) : null;

      if (entry.type === 'essay') {
        const userAnswer = given === null ? '' : String(given);
        let grade = { score: 0, feedback: 'Essay grading is currently unavailable.' };
        try {
          const question = questionByIndex.get(index);
          const gradeResult = await aiService.gradeEssay(
            (question && question.question) || '',
            entry.explanation || '',
            userAnswer
          );
          const numericScore = Number(gradeResult && gradeResult.score);
          const unreachable =
            gradeResult &&
            typeof gradeResult.feedback === 'string' &&
            gradeResult.feedback.startsWith(ESSAY_UNREACHABLE_MARKER);
          if (
            !gradeResult ||
            typeof gradeResult !== 'object' ||
            !Number.isFinite(numericScore) ||
            unreachable
          ) {
            aiUnavailable = true;
            grade = {
              score: Number.isFinite(numericScore) ? numericScore : 0,
              feedback:
                (gradeResult && gradeResult.feedback) || 'Essay grading is currently unavailable.',
            };
          } else {
            grade = { score: numericScore, feedback: gradeResult.feedback || '' };
          }
        } catch (err) {
          console.error('Essay grading failed:', err);
          aiUnavailable = true;
          grade = { score: 0, feedback: 'Essay grading is currently unavailable.' };
        }
        const essayScore = Math.max(0, Math.min(100, grade.score));
        essayScoreSum += essayScore;
        essayFeedbacks.push({ index, score: essayScore, feedback: String(grade.feedback || '') });
      } else {
        mcqTotal += 1;
        const question = questionByIndex.get(index);
        if (given !== null && mcqMatches(given, entry.correct_answer, question ? question.options : null)) {
          mcqCorrect += 1;
        }
      }
    }

    const totalQuestions = mcqTotal + essayFeedbacks.length;
    const score = totalQuestions > 0 ? (mcqCorrect * 100 + essayScoreSum) / totalQuestions : 0;

    // ── 4. Integrity verdict + persistence ──
    const assessment = integEngine.evaluate({
      keystrokeResult,
      pasteDetected,
      focusLossCount,
      voiceResult,
      lateSubmission,
      aiUnavailable,
    });
    const applied = await integEngine.apply(userId, assessment, attemptId);

    const integrity = {
      status: assessment.status,
      score: applied.scoreAfter,
      delta: assessment.delta,
      reasons: assessment.reasons,
    };
    const attemptStatus = aiUnavailable ? 'review_required' : 'graded';

    await db.query(
      `UPDATE assessment_attempts
       SET status = $1, submitted_at = $2, integrity = $3
       WHERE id = $4 AND status = 'in_progress'`,
      [attemptStatus, new Date(), JSON.stringify(integrity), attemptId]
    );

    const sanitizedAnswers = answers
      .filter((a) => a && Number.isFinite(Number(a.index)))
      .map((a) => ({
        index: Number(a.index),
        value: String(a.value === undefined || a.value === null ? '' : a.value),
      }));

    const wpm = metricsCalculator.calculateWPM(keystrokes);

    await db.query(
      `INSERT INTO quiz_results
         (user_id, material_slug, quiz_type, score, total_questions, correct_answers, details,
          keystroke_verified, keystroke_score, attempt_id, source, integrity_status, wpm, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'server', $11, $12, CURRENT_TIMESTAMP)`,
      [
        userId,
        attempt.material_slug,
        attempt.quiz_type,
        score,
        totalQuestions,
        mcqCorrect,
        JSON.stringify({
          questions,
          userAnswers: sanitizedAnswers,
          essayCount: essayFeedbacks.length,
          essayScoreSum,
          essayFeedbacks,
          integrity,
        }),
        keystrokeResult ? keystrokeResult.verified === true : null,
        keystrokeResult && typeof keystrokeResult.confidence === 'number'
          ? keystrokeResult.confidence
          : null,
        attemptId,
        assessment.status,
        wpm,
      ]
    );

    // Persist completion server-side: the old client wrote these slugs through
    // /user/sync, and the dashboard derives progress from user_progress.
    // Applies to both graded and review_required outcomes — the work was
    // submitted; the integrity gate (mint) is what protects credentials.
    await db.query(
      `INSERT INTO user_progress (user_id, material_slug, role, status, completed_at, updated_at)
       VALUES ($1, $2, $3, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, role, material_slug)
       DO UPDATE SET status = 'completed',
                     completed_at = COALESCE(user_progress.completed_at, CURRENT_TIMESTAMP),
                     updated_at = CURRENT_TIMESTAMP`,
      [userId, attempt.material_slug, attempt.role]
    );

    res.json({
      graded: true,
      attemptId,
      score,
      correctAnswers: mcqCorrect,
      totalQuestions,
      integrity,
      essayFeedbacks,
    });
  } catch (error) {
    console.error('Error submitting quiz attempt:', error);
    res.status(500).json({ error: 'Failed to submit the quiz attempt.' });
  }
};

// POST /api/v1/quiz/:attemptId/hint
exports.hint = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { attemptId } = req.params;

    if (!UUID_PATTERN.test(String(attemptId || ''))) {
      return res.status(404).json({ error: 'Assessment attempt not found.' });
    }

    const attemptRes = await db.query(
      `SELECT * FROM assessment_attempts WHERE id = $1`,
      [attemptId]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt || Number(attempt.user_id) !== Number(userId)) {
      return res.status(404).json({ error: 'Assessment attempt not found.' });
    }

    const body = req.body || {};
    const index = Number(body.index);
    if (body.index === undefined || body.index === null || !Number.isFinite(index)) {
      return res.status(400).json({ error: 'Question index is required.' });
    }

    if ((attempt.hints_used || 0) >= HINT_LIMIT) {
      return res.status(403).json({ error: 'You have used all your hints for this attempt.' });
    }

    const answerKey = Array.isArray(attempt.answer_key) ? attempt.answer_key : [];
    const entry = answerKey.find((e) => Number(e.index) === index);
    if (!entry) {
      return res.status(404).json({ error: 'Question not found for this attempt.' });
    }

    await db.query(
      `UPDATE assessment_attempts SET hints_used = COALESCE(hints_used, 0) + 1 WHERE id = $1`,
      [attemptId]
    );

    res.json({ hint: entry.explanation || '' });
  } catch (error) {
    console.error('Error fetching quiz hint:', error);
    res.status(500).json({ error: 'Failed to fetch the hint.' });
  }
};
