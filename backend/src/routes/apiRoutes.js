const express = require('express');
const router = express.Router();
const learningController = require('../controllers/learningController');
const integrityController = require('../controllers/integrityController');
const aiController = require('../controllers/aiController');

// Status route
router.get('/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Learning routes
router.get('/learning-path', learningController.getLearningPath);
router.get('/material', learningController.getMaterial);

// Integrity/verification routes
router.post('/verify-keystroke', integrityController.verifyKeystroke);

// Dynamic AI Generation routes
router.post('/generate-quiz', aiController.generateQuiz);
router.post('/generate-livecode', aiController.generateLivecode);
router.post('/generate-voice-challenge', aiController.generateVoiceChallenge);
router.post('/generate-final-challenge', aiController.generateFinalChallenge);
router.post('/verify-voice', aiController.verifyVoice);

module.exports = router;

