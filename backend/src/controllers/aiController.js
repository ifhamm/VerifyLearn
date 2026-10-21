const aiService = require('../services/aiService');
const db = require('../utils/db');
const { resolveMaterial } = require('../services/materialResolver');

exports.generateQuiz = async (req, res) => {
  try {
    const { role, slug, material, moduleMaterials, n_pg, n_essay } = req.body;
    let resolvedMaterial;

    // If moduleMaterials is provided, build a combined material for module quiz
    if (moduleMaterials && Array.isArray(moduleMaterials) && moduleMaterials.length > 0) {
      const titles = moduleMaterials.map(m => m.title).join(', ');
      const summaries = moduleMaterials.map(m => `[${m.title}] ${m.content_summary || ''}`).join('\n');
      resolvedMaterial = {
        id: `module-quiz`,
        slug: slug || moduleMaterials[0].slug,
        title: `Module Quiz (${titles})`,
        role: role || 'backend',
        topic_type: 'module_quiz',
        parent_topic: '',
        content_summary: summaries.slice(0, 600),
      };
    } else {
      try {
        resolvedMaterial = resolveMaterial(role, slug, material);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const data = await aiService.generateQuiz(resolvedMaterial, n_pg, n_essay);
    res.json({ message: 'Quiz generated successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.generateLivecode = async (req, res) => {
  try {
    const { role, slug, material, difficulty } = req.body;
    let resolvedMaterial;
    try {
      resolvedMaterial = resolveMaterial(role, slug, material);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const data = await aiService.generateLivecode(resolvedMaterial, difficulty);
    res.json({ message: 'Livecode challenge generated successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.generateVoiceChallenge = async (req, res) => {
  try {
    const { role, slug, material, userCodeOrText, user_code_or_text, triggerReason, trigger_reason } = req.body;
    const code = userCodeOrText || user_code_or_text;
    const reason = triggerReason || trigger_reason;

    if (!code || !reason) {
      return res.status(400).json({ error: 'Must include user code/text parameter and trigger reason (triggerReason).' });
    }

    let resolvedMaterial;
    try {
      resolvedMaterial = resolveMaterial(role, slug, material);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const data = await aiService.generateVoiceChallenge(resolvedMaterial, code, reason);
    res.json({ message: 'Voice challenge generated successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.generateFinalChallenge = async (req, res) => {
  try {
    const { role, slug, material } = req.body;
    let resolvedMaterial;
    try {
      resolvedMaterial = resolveMaterial(role, slug, material);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const data = await aiService.generateFinalChallenge(resolvedMaterial);
    res.json({ message: 'Final challenge generated successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verifyVoice = async (req, res) => {
  try {
    const { transcript, expectedKeywords } = req.body;
    if (!transcript || !expectedKeywords || !Array.isArray(expectedKeywords)) {
      return res.status(400).json({ error: 'Must include transcript and expectedKeywords (array).' });
    }

    const data = await aiService.verifyVoice(transcript, expectedKeywords);
    res.json({ message: 'Voice answer verified successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.gradeEssay = async (req, res) => {
  try {
    const { question, explanation, userAnswer, attempt_id, rubric } = req.body;
    if (!question || !explanation || !userAnswer) {
      return res.status(400).json({ error: 'Must include question, explanation, and userAnswer.' });
    }

    const data = await aiService.gradeEssay(question, explanation, userAnswer);

    // Phase 4 Feature 9 — honest provenance: save rubric feedback with AI flag
    if (attempt_id) {
      await db.query(`
        INSERT INTO essay_feedback (attempt_id, score, strengths, weaknesses, recommendations, rubric, model, used_ai)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        attempt_id,
        data.score ?? null,
        JSON.stringify(data.strengths ?? null),
        JSON.stringify(data.weaknesses ?? null),
        JSON.stringify(data.recommendations ?? null),
        JSON.stringify(rubric ?? null),
        data.model || 'unknown',
        true
      ]);
    }

    res.json({ message: 'Essay graded successfully', data, used_ai: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
