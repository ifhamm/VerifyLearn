const authController = require('../controllers/authController');

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Akses ditolak. Silakan login terlebih dahulu menggunakan Web3 wallet Anda.' });
  }

  const token = authHeader.split(' ')[1];
  const session = authController.sessions[token];

  if (!session) {
    return res.status(401).json({ error: 'Sesi login Anda tidak valid atau telah kedaluwarsa. Silakan login kembali.' });
  }

  // Attach session details to the request object
  req.user = session;
  next();
};
