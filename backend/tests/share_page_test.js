/**
 * End-to-end HTTP check for the public credential share page.
 *
 * Boots the REAL Express app (stubbed db + blockchainService so no live DB or
 * network is needed) on a throwaway port and asserts:
 *   - GET /verify/c/:id serves the credential page HTML (NOT the SPA index)
 *   - the page's own API calls would resolve (route wiring)
 *   - unknown /verify/c paths still serve the page (client shows the 404 state)
 *   - the SPA fallback still works for other extensionless paths
 */
const path = require('path');
const http = require('http');
const backend = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, actual !== undefined ? JSON.stringify(actual) : ''); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

const PORT = 4123;

const dbPath = path.join(backend, 'src', 'utils', 'db.js');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    pool: { async connect() { return { query: async () => ({ rows: [] }), release() {} }; }, end: async () => {} },
  },
};
const svcPath = path.join(backend, 'src', 'services', 'blockchainService.js');
require.cache[svcPath] = {
  id: svcPath, filename: svcPath, loaded: true,
  exports: { getMode: () => 'simulated', isConfigured: () => false, verifyOnChain: async () => ({ checked: false, valid: false, mode: 'simulated' }), mintSBT: async () => ({}) },
};
const dbInitPath = path.join(backend, 'src', 'utils', 'dbInit.js');
require.cache[dbInitPath] = { id: dbInitPath, filename: dbInitPath, loaded: true, exports: { initializeDatabase: async () => {} } };

process.env.PORT = String(PORT);
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.MINT_WATCHER_DISABLED = 'true';

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

(async () => {
  require(path.join(backend, 'src', 'app.js'));
  // Give the server a moment to bind
  await new Promise((r) => setTimeout(r, 600));

  section('T1 share page route');
  let r = await get('/verify/c/11111111-1111-1111-1111-111111111111');
  check('returns 200', r.status === 200, r.status);
  check('serves the credential page (not the SPA index)', r.body.includes('Verified <span class="text-brandViolet">Credential</span>') || r.body.includes('Verified'), r.body.slice(0, 80));
  check('has the credential JS', r.body.includes('/js/credential.js'), null);
  check('has the QR image element', r.body.includes('id="qrImage"'), null);
  check('not the landing page', !r.body.includes('Master the Digital Frontier') && !r.body.includes('heroSection'), null);

  section('T2 credential data API is reachable from the page');
  r = await get('/api/v1/credentials/11111111-1111-1111-1111-111111111111');
  check('unknown id => 404 JSON', r.status === 404 && r.body.includes('not found'), r.body);

  section('T3 SPA fallback preserved elsewhere');
  r = await get('/some/other/path');
  check('unknown extensionless path still serves index.html', r.status === 200 && r.body.includes('<!DOCTYPE html>'), r.status);

  section('T4 static assets for the new page');
  r = await get('/js/credential.js');
  check('credential.js served as JS', r.status === 200 && /javascript/.test(r.headers['content-type'] || ''), r.headers['content-type']);
  r = await get('/credential.html');
  check('credential.html directly reachable', r.status === 200, r.status);

  console.log('\n----------------------------------------');
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('SHARE PAGE TEST CRASHED:', e);
  process.exit(1);
});
