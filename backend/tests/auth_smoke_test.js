const path = require('path');
const assert = require('assert');
const backend = path.join(__dirname, '..');

process.env.APP_ENV = 'development';
delete process.env.ALLOW_MOCK_LOGIN;

// ---- In-memory DB stub ----
const tables = { auth_nonces: [], users: [], user_sessions: [], user_learning_paths: [], user_progress: [] };
let userSeq = 1;

function mockQuery(text, params = []) {
  const q = text.replace(/\s+/g, ' ').trim();
  if (q.startsWith('INSERT INTO auth_nonces')) {
    tables.auth_nonces.push({ nonce: params[0], wallet_address: params[1], message: params[2], used: false, expires_at: params[3] });
    return { rows: [] };
  }
  if (q.startsWith('SELECT nonce, message, used, expires_at FROM auth_nonces')) {
    const row = tables.auth_nonces.find(n => n.nonce === params[0] && n.wallet_address === params[1]);
    return { rows: row ? [{ ...row }] : [] };
  }
  if (q.startsWith('UPDATE auth_nonces SET used = TRUE')) {
    const row = tables.auth_nonces.find(n => n.nonce === params[0]);
    if (row) row.used = true;
    return { rows: [] };
  }
  if (q.startsWith('DELETE FROM auth_nonces')) {
    return { rows: [] };
  }
  if (q.startsWith('INSERT INTO users')) {
    const addr = params[0];
    let user = tables.users.find(u => u.wallet_address === addr);
    if (user) { user.username = params[1] || user.username; user.is_mock = params[2]; }
    else { user = { id: userSeq++, wallet_address: addr, username: params[1], is_mock: params[2], integrity_score: 100 }; tables.users.push(user); }
    return { rows: [{ ...user }] };
  }
  if (q.startsWith('SELECT plan_data FROM user_learning_paths')) return { rows: [] };
  if (q.startsWith('SELECT material_slug FROM user_progress')) return { rows: [] };
  if (q.startsWith('INSERT INTO user_sessions')) {
    tables.user_sessions.push({ token: params[0], user_id: params[1], expires_at: params[2] });
    return { rows: [] };
  }
  if (q.startsWith('SELECT s.token, u.id as user_id')) {
    const row = tables.user_sessions.find(s => s.token === params[0] && s.expires_at > new Date());
    if (!row) return { rows: [] };
    const user = tables.users.find(u => u.id === row.user_id);
    return { rows: [{ token: row.token, user_id: user.id, wallet_address: user.wallet_address, username: user.username, integrity_score: user.integrity_score, is_mock: user.is_mock }] };
  }
  if (q.startsWith('DELETE FROM user_sessions')) {
    if (params.length) tables.user_sessions = tables.user_sessions.filter(s => s.token !== params[0]);
    else tables.user_sessions = [];
    return { rows: [] };
  }
  throw new Error('Unhandled query in stub: ' + q);
}

const dbPath = path.join(backend, 'src', 'utils', 'db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: mockQuery, pool: {} } };

const authController = require(path.join(backend, 'src', 'controllers', 'authController.js'));

function res() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

(async () => {
  // 1. requestNonce rejects bad address
  let r = res();
  await authController.requestNonce({ body: { address: 'nope' } }, r);
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS  requestNonce rejects invalid address');

  // 2. requestNonce issues message-bound challenge
  const { ethers } = require(path.join(backend, 'node_modules', 'ethers'));
  const wallet = ethers.Wallet.createRandom();
  r = res();
  await authController.requestNonce({ body: { address: wallet.address } }, r);
  assert.strictEqual(r.statusCode, 200);
  assert.ok(r.body.message.includes(r.body.nonce));
  assert.ok(r.body.message.includes(wallet.address.toLowerCase()));
  console.log('PASS  requestNonce issues nonce-bound message');

  // 3. real login without nonce -> 400
  r = res();
  await authController.login({ body: { address: wallet.address, signature: '0xsig', message: 'x' } }, r);
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS  login without nonce rejected');

  // 4. sign + login success
  const firstNonce = tables.auth_nonces[0];
  const sig = await wallet.signMessage(firstNonce.message);
  r = res();
  await authController.login({ body: { address: wallet.address, signature: sig, message: firstNonce.message, nonce: firstNonce.nonce } }, r);
  assert.strictEqual(r.statusCode, 200);
  assert.ok(r.body.token && r.body.token.length === 64);
  assert.strictEqual(r.body.walletAddress, wallet.address.toLowerCase());
  // token stored hashed, not plaintext
  const stored = tables.user_sessions.find(s => s.user_id === 1);
  const crypto = require('crypto');
  assert.strictEqual(stored.token, crypto.createHash('sha256').update(r.body.token).digest('hex'));
  console.log('PASS  real login succeeds; session token stored as SHA-256 hash');

  // 5. replay same nonce -> 401
  const w2 = ethers.Wallet.createRandom();
  r = res();
  await authController.requestNonce({ body: { address: w2.address } }, r);
  const nonce2 = r.body.nonce, msg2 = r.body.message;
  const sig2 = await w2.signMessage(msg2);
  r = res();
  await authController.login({ body: { address: w2.address, signature: sig2, message: msg2, nonce: nonce2 } }, r);
  assert.strictEqual(r.statusCode, 200);
  const usedToken = tables.auth_nonces.find(n => n.nonce === nonce2).used;
  assert.strictEqual(usedToken, true);
  r = res();
  await authController.login({ body: { address: w2.address, signature: sig2, message: msg2, nonce: nonce2 } }, r);
  assert.strictEqual(r.statusCode, 401);
  console.log('PASS  nonce replay rejected (single-use enforced)');

  // 6. tampered message -> 401
  const w3 = ethers.Wallet.createRandom();
  r = res();
  await authController.requestNonce({ body: { address: w3.address } }, r);
  const nonce3 = r.body.nonce;
  const goodMsg = r.body.message;
  const tampered = goodMsg.replace('Sign this message', 'SIGN THIS NOW');
  const sig3 = await w3.signMessage(tampered);
  r = res();
  await authController.login({ body: { address: w3.address, signature: sig3, message: tampered, nonce: nonce3 } }, r);
  assert.strictEqual(r.statusCode, 401);
  console.log('PASS  tampered (client-modified) message rejected');

  // 7. expired nonce -> 401
  const w4 = ethers.Wallet.createRandom();
  r = res();
  await authController.requestNonce({ body: { address: w4.address } }, r);
  const nonce4 = r.body.nonce, msg4 = r.body.message;
  tables.auth_nonces.find(n => n.nonce === nonce4).expires_at = new Date(Date.now() - 1000);
  const sig4 = await w4.signMessage(msg4);
  r = res();
  await authController.login({ body: { address: w4.address, signature: sig4, message: msg4, nonce: nonce4 } }, r);
  assert.strictEqual(r.statusCode, 401);
  console.log('PASS  expired nonce rejected');

  // 8. signature from wrong wallet -> 401
  const w5 = ethers.Wallet.createRandom();
  const w5b = ethers.Wallet.createRandom();
  r = res();
  await authController.requestNonce({ body: { address: w5.address } }, r);
  const msg5 = r.body.message, nonce5 = r.body.nonce;
  const sig5 = await w5b.signMessage(msg5);
  r = res();
  await authController.login({ body: { address: w5.address, signature: sig5, message: msg5, nonce: nonce5 } }, r);
  assert.strictEqual(r.statusCode, 401);
  console.log('PASS  signature from a different wallet rejected');

  // 9. mock login: deterministic address, spoof-resistant
  r = res();
  await authController.login({ body: { username: 'Alice Dev', isMock: true, address: wallet.address, signature: 'mock-signature' } }, r);
  assert.strictEqual(r.statusCode, 200);
  const aliceAddr = r.body.walletAddress;
  assert.notStrictEqual(aliceAddr, wallet.address.toLowerCase(), 'mock login must ignore client-supplied address');
  r = res();
  await authController.login({ body: { username: 'Alice Dev', isMock: true } }, r);
  assert.strictEqual(r.body.walletAddress, aliceAddr);
  r = res();
  await authController.login({ body: { username: 'Bob Dev', isMock: true } }, r);
  assert.notStrictEqual(r.body.walletAddress, aliceAddr);
  console.log('PASS  mock login derives deterministic per-username wallet; client address ignored');

  // 10. mock login: invalid username rejected
  r = res();
  await authController.login({ body: { username: '<img src=x onerror=alert(1)>', isMock: true } }, r);
  assert.strictEqual(r.statusCode, 400);
  r = res();
  await authController.login({ body: { username: 'ab', isMock: true } }, r);
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS  invalid usernames rejected (XSS-safe charset enforced)');

  // 11. mock login disabled in production
  delete require.cache[dbPath];
  const ctrlPath = path.join(backend, 'src', 'controllers', 'authController.js');
  delete require.cache[ctrlPath];
  // also bust sessionService which captured nothing env-wise
  process.env.APP_ENV = 'production';
  process.env.ALLOW_MOCK_LOGIN = 'false';
  const prodAuth = require(ctrlPath);
  r = res();
  await prodAuth.login({ body: { username: 'Mallory', isMock: true } }, r);
  assert.strictEqual(r.statusCode, 403);
  console.log('PASS  mock login returns 403 in production (APP_ENV=production)');

  // 12. logout deletes hashed session
  process.env.APP_ENV = 'development';
  delete process.env.ALLOW_MOCK_LOGIN;
  r = res();
  await authController.logout({ headers: { authorization: 'Bearer ' + 'deadbeef'.repeat(8) } }, r);
  assert.strictEqual(r.statusCode, 200);
  console.log('PASS  logout handles hashed tokens');

  console.log('\nALL 12 AUTH SMOKE TESTS PASSED');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
