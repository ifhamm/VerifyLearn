/**
 * App boot smoke test: boots src/app.js with stubbed db/dbInit and verifies
 * the full middleware chain — helmet headers, status endpoint, JSON 404 for
 * unknown API paths, SPA fallback, and the auth rate limiter tripping.
 */
const path = require('path');
const backend = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, actual !== undefined ? JSON.stringify(actual) : ''); }
}

const dbInitPath = path.join(backend, 'src', 'utils', 'dbInit.js');
require.cache[dbInitPath] = {
  id: dbInitPath, filename: dbInitPath, loaded: true,
  exports: { initializeDatabase: async () => {} },
};
const dbPath = path.join(backend, 'src', 'utils', 'db.js');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [] }), pool: { end: async () => {} } },
};

process.env.PORT = '3999';
require(path.join(backend, 'src', 'app.js'));

setTimeout(async () => {
  try {
    const base = 'http://127.0.0.1:3999';

    const s = await fetch(base + '/api/v1/status');
    const j = await s.json();
    check('status endpoint 200 ok', s.status === 200 && j.status === 'ok', { code: s.status, body: j });
    check('helmet sets nosniff header', s.headers.get('x-content-type-options') === 'nosniff');

    const nf = await fetch(base + '/api/v1/does-not-exist');
    const nfj = await nf.json();
    check('unknown API path => JSON 404', nf.status === 404 && nfj.error === 'Not found.', { code: nf.status, body: nfj });

    const spa = await fetch(base + '/verify');
    check('SPA fallback serves index.html', spa.status === 200, spa.status);

    let blocked = 0;
    let ok = 0;
    for (let i = 0; i < 35; i++) {
      const r = await fetch(base + '/api/v1/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: 'x' }),
      });
      if (r.status === 429) blocked++; else ok++;
    }
    check('auth limiter allows 30 then blocks', ok === 30 && blocked === 5, { ok, blocked });

    console.log('\n----------------------------------------');
    console.log(`PASSED: ${pass}   FAILED: ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('BOOT TEST CRASHED:', e);
    process.exit(1);
  }
}, 800);
