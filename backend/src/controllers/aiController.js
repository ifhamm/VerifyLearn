const aiService = require('../services/aiService');
const { findMaterial } = require('../services/learningPathService');

// Helper to resolve material from payload
const resolveMaterial = (role, slug, material) => {
  if (material) return material;
  if (!role || !slug) {
    throw new Error('Harus menyertakan objek material atau parameter (role dan slug).');
  }
  const found = findMaterial(role, slug);
  if (!found) {
    throw new Error(`Material tidak ditemukan untuk role: ${role}, slug: ${slug}`);
  }
  // Convert JSONL structure to the structure expected by python_ai server
  return {
    id: found.doc_id,
    slug: found.slug,
    title: found.topic_name,
    role: found.role,
    topic_type: found.topic_type,
    parent_topic: found.parent_topic,
    content_summary: (found.content || '').slice(0, 300).trim(),
  };
};

exports.generateQuiz = async (req, res) => {
  try {
    const { role, slug, material, n_pg, n_essay } = req.body;
    let resolvedMaterial;
    try {
      resolvedMaterial = resolveMaterial(role, slug, material);
    } catch (err) {
      return res.status(400).json({ error: err.message });
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
      return res.status(400).json({ error: 'Harus menyertakan parameter code/text user dan alasan trigger (triggerReason).' });
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
