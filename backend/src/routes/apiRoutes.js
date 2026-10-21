const express = require('express');
const router = express.Router();
const learningController = require('../controllers/learningController');
const integrityController = require('../controllers/integrityController');
const aiController = require('../controllers/aiController');
const authController = require('../controllers/authController');
const walletAuth = require('../middlewares/walletAuth');
const userController = require('../controllers/userController');
const sbtController = require('../controllers/sbtController');
const assessmentController = require('../controllers/assessmentController');
const adminAuth = require('../middlewares/adminAuth');
const credentialController = require('../controllers/credentialController');
const dashboardController = require('../controllers/dashboardController');

// Status route
router.get('/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Auth routes
router.post('/auth/nonce', authController.requestNonce);
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/session', authController.checkSession);

// User progress & DB Sync routes
router.post('/user/sync', walletAuth, userController.syncProgress);
// Retired client-trusted grading endpoints — grading now happens server-side
const retiredGradingHandler = (req, res) => {
  res.status(410).json({ error: 'This endpoint has been retired. Server-side grading is now required.' });
};
router.post('/quiz/result', walletAuth, retiredGradingHandler);
router.get('/quiz/result', walletAuth, userController.getQuizResult);
router.get('/quiz/results', walletAuth, userController.getAllQuizResults);
router.post('/user/note', walletAuth, userController.saveNote);
router.get('/user/note', walletAuth, userController.getNote);

// Server-side assessment routes (start / submit / hint)
router.post('/quiz/start', walletAuth, assessmentController.start);
router.post('/quiz/:attemptId/submit', walletAuth, assessmentController.submit);
router.post('/quiz/:attemptId/hint', walletAuth, assessmentController.hint);

// SBT routes
router.get('/user/sbts', walletAuth, sbtController.getUserSBTs);
router.post('/user/mint-sbt', walletAuth, sbtController.mintSBT);
router.get('/sbt/verify/:walletAddress', sbtController.verifySBT);

// Admin credential management — ADMIN_WALLETS allowlist (fail-closed)
router.post('/admin/sbt/:credentialId/revoke', walletAuth, adminAuth, sbtController.adminRevoke);

// Public credential sharing (Credential Share Pack) — no auth: a credential
// id is an unguessable UUID and the point is third-party verification.
router.get('/credentials/:credentialId', credentialController.getCredential);
router.get('/credentials/:credentialId/vc', credentialController.getCredentialVC);
router.get('/credentials/:credentialId/qr.png', credentialController.getCredentialQR);


// Learning routes
router.get('/learning-path', walletAuth, learningController.getLearningPath);
router.get('/material', learningController.getMaterial);

// Integrity/verification routes
router.post('/verify-keystroke', walletAuth, integrityController.verifyKeystroke);
router.get('/integrity/score', walletAuth, integrityController.getScore);
router.get('/dashboard/insights', walletAuth, dashboardController.getInsights);

// Dynamic AI Generation routes
router.post('/generate-quiz', walletAuth, aiController.generateQuiz);
router.post('/generate-livecode', walletAuth, aiController.generateLivecode);
router.post('/generate-voice-challenge', walletAuth, aiController.generateVoiceChallenge);
router.post('/generate-final-challenge', walletAuth, aiController.generateFinalChallenge);
router.post('/verify-voice', walletAuth, retiredGradingHandler);
router.post('/grade-essay', walletAuth, retiredGradingHandler);

module.exports = router;

