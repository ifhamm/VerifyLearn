const aiService = require('../services/aiService');

exports.verifyKeystroke = async (req, res) => {
  try {
    const keystrokes = req.body.keystrokes || req.body.keystrokePattern;
    if (!keystrokes || !Array.isArray(keystrokes)) {
      return res.status(400).json({ error: 'Format keystrokes tidak valid atau kosong.' });
    }

    const result = await aiService.analyzeKeystrokes(keystrokes);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

