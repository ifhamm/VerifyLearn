const express = require('express');
const router = express.Router();
const learningController = require('../controllers/learningController');
const integrityController = require('../controllers/integrityController');
const aiController = require('../controllers/aiController');
const authController = require('../controllers/authController');
const walletAuth = require('../middlewares/walletAuth');

// Status route
router.get('/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Auth routes
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/session', authController.checkSession);

// Learning routes
router.get('/learning-path', walletAuth, learningController.getLearningPath);
router.get('/material', learningController.getMaterial);

// Integrity/verification routes
router.post('/verify-keystroke', walletAuth, integrityController.verifyKeystroke);

// Dynamic AI Generation routes
router.post('/generate-quiz', walletAuth, aiController.generateQuiz);
router.post('/generate-livecode', walletAuth, aiController.generateLivecode);
router.post('/generate-voice-challenge', walletAuth, aiController.generateVoiceChallenge);
router.post('/generate-final-challenge', walletAuth, aiController.generateFinalChallenge);
router.post('/verify-voice', walletAuth, aiController.verifyVoice);

module.exports = router;

