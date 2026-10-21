const path = require('path');
// Load environment variables from root .env file
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy (nginx/caddy in production) set TRUST_PROXY to the
// number of proxy hops (usually 1) so rate limits key on the real client IP.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10) || 1);
}

// Security headers. CSP is deliberately deferred: the vanilla-JS frontend
// relies on inline event handlers (onclick=...) which a strict CSP breaks;
// enabling it requires a frontend refactor first.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS: restrict to configured origins in production (comma-separated list),
// open in development.
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }
  : {};
app.use(cors(corsOptions));

// Body parsing with explicit size limits (quiz answers + keystroke logs are
// the largest legitimate payloads)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ---------------------------------------------------------------------------
// Rate limiting (per IP). Skipped entirely when RATE_LIMIT_DISABLED=true
// (integration tests / local debugging only — never set in production).
// ---------------------------------------------------------------------------
if (process.env.RATE_LIMIT_DISABLED !== 'true') {
  const makeLimiter = (windowMs, limit, message) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: message },
    });

  // Broad backstop for the whole API
  app.use('/api', makeLimiter(15 * 60 * 1000, 300, 'Too many requests, please try again later.'));

  // Auth endpoints: nonce issuance and signature verification are cheap to
  // flood and expensive to serve
  app.use('/api/v1/auth', makeLimiter(15 * 60 * 1000, 30, 'Too many authentication attempts, please try again later.'));

  // AI-generating endpoints: quota per IP (agent.md: rate limit AI content)
  const aiPaths = [
    '/api/v1/quiz/start',
    '/api/v1/generate-quiz',
    '/api/v1/generate-livecode',
    '/api/v1/generate-voice-challenge',
    '/api/v1/generate-final-challenge',
    '/api/v1/verify-keystroke',
  ];
  const aiLimiter = makeLimiter(5 * 60 * 1000, 20, 'AI request quota exceeded, please slow down.');
  aiPaths.forEach((p) => app.use(p, aiLimiter));

  // Credential minting: strict — each mint touches the chain
  app.use('/api/v1/user/mint-sbt', makeLimiter(15 * 60 * 1000, 10, 'Too many mint requests, please try again later.'));
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve sweetalert2 statically from node_modules
app.use('/vendor/sweetalert2', express.static(path.join(__dirname, '../node_modules/sweetalert2/dist')));

// API Routes
const apiRoutes = require('./routes/apiRoutes');
app.use('/api/v1', apiRoutes);

// Unknown API paths get a JSON 404, never the SPA index.html
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

const { initializeDatabase } = require('./utils/dbInit');

// Fallback to index.html for SPA if needed, or simple status
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Central error handler: log details server-side, never leak internals.
// Controllers are expected to handle their own errors; this is the backstop.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error.' });
});

// Initialize database and start server
initializeDatabase()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // Resolve credentials stuck mid-mint (broadcast without a receipt, or a
    // hashless pending row) — see services/mintWatcher.js.
    require('./services/mintWatcher').start();

    // Graceful shutdown: stop accepting connections, close the DB pool.
    const shutdown = (signal) => {
      console.log(`${signal} received — shutting down gracefully...`);
      require('./services/mintWatcher').stop();
      server.close(() => {
        require('./utils/db').pool
          .end()
          .catch(() => {})
          .finally(() => process.exit(0));
      });
      // Hard exit if connections refuse to drain
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('Database initialization failed. Exiting.', err);
    process.exit(1);
  });
