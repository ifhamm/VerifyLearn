const express = require('express');
const router = express.Router();
const learningController = require('../controllers/learningController');
const integrityController = require('../controllers/integrityController');
const aiController = require('../controllers/aiController');
const authController = require('../controllers/authController');
const walletAuth = require('../middlewares/walletAuth');
const userController = require('../controllers/userController');
const sbtController = require('../controllers/sbtController');

// Status route
router.get('/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Auth routes
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/session', authController.checkSession);

// User progress & DB Sync routes
router.post('/user/sync', walletAuth, userController.syncProgress);
router.post('/quiz/result', walletAuth, userController.saveQuizResult);
router.get('/quiz/result', walletAuth, userController.getQuizResult);
router.get('/quiz/results', walletAuth, userController.getAllQuizResults);
router.post('/user/note', walletAuth, userController.saveNote);
router.get('/user/note', walletAuth, userController.getNote);

// SBT routes
router.get('/user/sbts', walletAuth, sbtController.getUserSBTs);
router.post('/user/mint-sbt', walletAuth, sbtController.mintSBT);
router.get('/sbt/verify/:walletAddress', sbtController.verifySBT);


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
router.post('/grade-essay', walletAuth, aiController.gradeEssay);

module.exports = router;

