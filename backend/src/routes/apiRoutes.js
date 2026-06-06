const express = require('express');
const router = express.Router();
const learningController = require('../controllers/learningController');
const integrityController = require('../controllers/integrityController');

// Status route
router.get('/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Learning routes
router.get('/learning-path', learningController.getLearningPath);

// Integrity/verification routes
router.post('/verify-keystroke', integrityController.verifyKeystroke);

module.exports = router;
