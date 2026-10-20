/**
 * Blockchain smoke test (Phase 1d + Sprint-1 hardening).
 *
 * Runs WITHOUT network and WITHOUT a database:
 *   Part 1 exercises the real blockchainService (mode resolution, simulated
 *     mint marking, real-mode fail-fast, verifyOnChain guards).
 *   Part 2 exercises sbtController with require.cache-stubbed db +
 *     blockchainService: pending -> confirmed | failed lifecycle, 502 on
 *     real failure (never a fabricated hash), retry of failed rows,
 *     honest verify payload (per-credential onChain status).
 */
const path = require('path');
const assert = require('assert');
const backend = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, actual !== undefined ? JSON.stringify(actual) : ''); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

const ENV_KEYS = ['BLOCKCHAIN_MODE', 'APP_ENV', 'RPC_URL', 'SYSTEM_PRIVATE_KEY', 'SBT_CONTRACT_ADDRESS', 'EXPLORER_URL'];
function setEnv(obj) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, obj);
}
const FULL_CONFIG = {
  RPC_URL: 'http://127.0.0.1:9', // never contacted: guards return before any provider use
  SYSTEM_PRIVATE_KEY: '0x' + '1'.repeat(64),
  SBT_CONTRACT_ADDRESS: '0x' + '2'.repeat(40),
};

(async () => {
  // =====================================================================
  // PART 1 — real blockchainService, env-driven
  // =====================================================================
  const svc = require(path.join(backend, 'src', 'services', 'blockchainService.js'));

  section('T1 getMode resolution');
  setEnv({ BLOCKCHAIN_MODE: 'real', APP_ENV: 'development' });
  check('explicit real wins in dev', svc.getMode() === 'real', svc.getMode());
  setEnv({ BLOCKCHAIN_MODE: 'simulated', APP_ENV: 'production' });
  check('explicit simulated wins even in production', svc.getMode() === 'simulated', svc.getMode());
  setEnv({ APP_ENV: 'production' });
  check('production defaults to real', svc.getMode() === 'real', svc.getMode());
  setEnv({ APP_ENV: 'development', ...FULL_CONFIG });
  check('dev + full config => real', svc.getMode() === 'real', svc.getMode());
  setEnv({ APP_ENV: 'development' });
  check('dev + no config => simulated', svc.getMode() === 'simulated', svc.getMode());
  setEnv({ BLOCKCHAIN_MODE: 'gibberish', APP_ENV: 'production' });
  check('garbage BLOCKCHAIN_MODE ignored (prod => real)', svc.getMode() === 'real', svc.getMode());

  section('T2 mintSBT simulated mode is clearly marked');
  setEnv({ BLOCKCHAIN_MODE: 'simulated' });
  let m = await svc.mintSBT('0xabc', 'module_1');
  check('simulated === true', m.simulated === true, m);
  check('hash is 64-hex mock format', /^0x[0-9a-f]{64}$/.test(m.transactionHash), m.transactionHash);
  check('tokenId is a number', typeof m.tokenId === 'number', m.tokenId);
  check('status confirmed', m.status === 'confirmed', m.status);

  section('T3 mintSBT real mode fails fast when unconfigured (no fake hash)');
  setEnv({ BLOCKCHAIN_MODE: 'real' });
  let threw = null;
  try { await svc.mintSBT('0xabc', 'module_1'); } catch (e) { threw = e; }
  check('throws instead of returning', !!threw, 'no error');
  check('error code NOT_CONFIGURED', threw && threw.code === 'NOT_CONFIGURED', threw && threw.code);

  section('T4 verifyOnChain guards (no network, no provider constructed)');
  setEnv({ BLOCKCHAIN_MODE: 'simulated' });
  let v = await svc.verifyOnChain({ simulated: true, txHash: '0xdead' });
  check('simulated record => simulated_mint', v.checked === false && v.reason === 'simulated_mint', v);
  check('simulated record exposes no explorer link', v.explorerUrl === null, v.explorerUrl);
  v = await svc.verifyOnChain({ walletAddress: '0xW', moduleId: 'm1', txHash: '0xdead' });
  check('simulated mode => not_real_mode', v.checked === false && v.reason === 'not_real_mode', v);
  setEnv({ BLOCKCHAIN_MODE: 'real' });
  v = await svc.verifyOnChain({ walletAddress: '0xW', moduleId: 'm1' });
  check('real but unconfigured => not_configured', v.checked === false && v.reason === 'not_configured', v);
  setEnv({ BLOCKCHAIN_MODE: 'real', ...FULL_CONFIG, EXPLORER_URL: 'https://example.com' });
  v = await svc.verifyOnChain({ txHash: '0xdead' }); // no tokenId, no wallet+moduleId
  check('no usable proof => insufficient_proof', v.checked === false && v.reason === 'insufficient_proof', v);
  check('explorer url honors EXPLORER_URL', v.explorerUrl === 'https://example.com/tx/0xdead', v.explorerUrl);

  // =====================================================================
  // PART 2 — sbtController with stubbed db + blockchainService
  // =====================================================================
  const state = {
    seq: 0,
    users: [{ id: 1, wallet_address: '0xUSER', username: 'learner', integrity_score: 85 }],
    sbts: [],
    quizResultsOk: true,
    raceInsert: false,
  };

  function mockQuery(text, params = []) {
    const q = text.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT id, status FROM user_sbts')) {
      const row = state.sbts.find((s) => Number(s.user_id) === Number(params[0]) && s.module_id === params[1]);
      return { rows: row ? [{ id: row.id, status: row.status }] : [] };
    }
    if (q.startsWith('SELECT wallet_address, integrity_score FROM users')) {
      const row = state.users.find((u) => Number(u.id) === Number(params[0]));
      return { rows: row ? [{ wallet_address: row.wallet_address, integrity_score: row.integrity_score }] : [] };
    }
    if (q.startsWith('INSERT INTO user_sbts')) {
      if (state.raceInsert) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
      // The controller's INSERT uses SQL literals for tx_token/status:
      // VALUES ($1, $2, '', NULL, 'pending') — only two bind params.
      const row = {
        id: ++state.seq,
        user_id: params[0],
        module_id: params[1],
        tx_hash: '',
        token_id: null,
        status: 'pending',
        simulated: false,
      };
      state.sbts.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (q.startsWith(`UPDATE user_sbts SET status = 'pending'`)) {
      const row = state.sbts.find((s) => Number(s.id) === Number(params[0]));
      if (row) row.status = 'pending';
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith('UPDATE user_sbts SET tx_hash =')) {
      const row = state.sbts.find((s) => Number(s.id) === Number(params[3]));
      if (row) { row.tx_hash = params[0]; row.token_id = params[1]; row.simulated = params[2]; row.status = 'confirmed'; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith(`UPDATE user_sbts SET status = 'failed'`)) {
      const row = state.sbts.find((s) => Number(s.id) === Number(params[0]));
      if (row) row.status = 'failed';
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith('SELECT id, module_id, tx_hash, token_id, minted_at, status, simulated FROM user_sbts')) {
      return { rows: state.sbts.filter((s) => Number(s.user_id) === Number(params[0]) && s.status !== 'failed') };
    }
    if (q.startsWith('SELECT module_id, tx_hash, token_id, minted_at, status, simulated FROM user_sbts')) {
      return { rows: state.sbts.filter((s) => Number(s.user_id) === Number(params[0]) && s.status !== 'failed') };
    }
    if (q.startsWith('SELECT id FROM quiz_results')) {
      return { rows: state.quizResultsOk ? [{ id: 1 }] : [] };
    }
    if (q.startsWith('SELECT id, username, wallet_address, integrity_score FROM users WHERE LOWER')) {
      const row = state.users.find((u) => String(u.wallet_address).toLowerCase() === String(params[0]).toLowerCase());
      return { rows: row ? [{ ...row }] : [] };
    }
    throw new Error('fake db: unhandled query -> ' + q);
  }

  const dbPath = path.join(backend, 'src', 'utils', 'db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: mockQuery, pool: {} } };

  const svcPath = path.join(backend, 'src', 'services', 'blockchainService.js');
  const svcStub = {
    _mintImpl: () => ({ transactionHash: '0x' + 'ab'.repeat(32), tokenId: 7, status: 'confirmed', simulated: true }),
    _verifyCalls: [],
    _verifyImpl: (proof) => {
      svcStub._verifyCalls.push(proof);
      if (proof.simulated) return { checked: false, valid: false, mode: 'simulated', reason: 'simulated_mint', explorerUrl: null };
      return { checked: true, valid: true, mode: 'simulated', explorerUrl: null };
    },
    getMode: () => 'simulated',
    mintSBT: async () => svcStub._mintImpl(),
    verifyOnChain: async (proof) => svcStub._verifyImpl(proof),
  };
  require.cache[svcPath] = { id: svcPath, filename: svcPath, loaded: true, exports: svcStub };

  const sbtController = require(path.join(backend, 'src', 'controllers', 'sbtController.js'));

  function res() {
    return {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  }
  const reqFor = (userId, body) => ({ user: { userId }, body: body || {}, params: {} });

  section('T5 mint gate (integrity threshold)');
  state.users[0].integrity_score = 50;
  let r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_1' }), r);
  check('integrity < 70 => 400', r.statusCode === 400, r.statusCode);
  check('no row created when gated', state.sbts.length === 0, state.sbts.length);
  state.users[0].integrity_score = 85;

  section('T6 mint success (simulated) persists confirmed row');
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_1' }), r);
  check('200 + success', r.statusCode === 200 && r.body.success === true, { code: r.statusCode, body: r.body });
  check('response flags simulated', r.body.data.simulated === true, r.body.data);
  check('response message admits simulation', /simulated/i.test(r.body.message), r.body.message);
  check('row confirmed + simulated in db', state.sbts[0].status === 'confirmed' && state.sbts[0].simulated === true, state.sbts[0]);
  check('real tx hash persisted', state.sbts[0].tx_hash === r.body.data.txHash, state.sbts[0].tx_hash);

  section('T7 duplicate + pending guards');
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_1' }), r);
  check('confirmed row => 400 already minted', r.statusCode === 400, r.statusCode);
  state.sbts[0].status = 'pending';
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_1' }), r);
  check('pending row => 409 in progress', r.statusCode === 409, r.statusCode);
  state.sbts.length = 0;

  section('T8 real failure => 502, row failed, NO fabricated hash');
  svcStub._mintImpl = () => { const e = new Error('tx reverted'); e.code = 'ONCHAIN_FAILED'; throw e; };
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_2' }), r);
  check('502 on real failure', r.statusCode === 502, r.statusCode);
  check('honest error message', /no credential was recorded/i.test(r.body.error), r.body.error);
  check('row marked failed', state.sbts[0].status === 'failed', state.sbts[0].status);
  check('no fabricated tx hash', state.sbts[0].tx_hash === '', state.sbts[0].tx_hash);

  section('T9 failed row is retried and reused');
  svcStub._mintImpl = () => ({ transactionHash: '0x' + 'cd'.repeat(32), tokenId: 8, status: 'confirmed', simulated: false });
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_2' }), r);
  check('retry succeeds', r.statusCode === 200 && r.body.success === true, { code: r.statusCode, body: r.body });
  check('response marks real mint', r.body.data.simulated === false, r.body.data);
  check('same row reused (no duplicate)', state.sbts.length === 1, state.sbts.length);
  check('row now confirmed', state.sbts[0].status === 'confirmed' && state.sbts[0].tx_hash === r.body.data.txHash, state.sbts[0]);

  section('T10 insert race => 409 (unique violation)');
  state.sbts.length = 0;
  state.raceInsert = true;
  r = res();
  await sbtController.mintSBT(reqFor(1, { moduleId: 'module_3' }), r);
  check('23505 mapped to 409', r.statusCode === 409, r.statusCode);
  state.raceInsert = false;

  section('T11 getUserSBTs hides failed rows');
  state.sbts.length = 0;
  state.sbts.push(
    { id: ++state.seq, user_id: 1, module_id: 'module_1', tx_hash: '0xaa', token_id: 1, status: 'confirmed', simulated: true },
    { id: ++state.seq, user_id: 1, module_id: 'module_2', tx_hash: '', token_id: null, status: 'failed', simulated: false }
  );
  r = res();
  await sbtController.getUserSBTs(reqFor(1), r);
  check('only non-failed rows returned', r.body.data.length === 1 && r.body.data[0].module_id === 'module_1', r.body.data);
  check('status + simulated exposed', r.body.data[0].status === 'confirmed' && r.body.data[0].simulated === true, r.body.data[0]);

  section('T12 verifySBT attaches honest per-credential onChain status');
  state.sbts.length = 0;
  state.sbts.push(
    { id: ++state.seq, user_id: 1, module_id: 'module_1', tx_hash: '0xaa', token_id: 1, status: 'confirmed', simulated: false },
    { id: ++state.seq, user_id: 1, module_id: 'module_2', tx_hash: '0xbb', token_id: 2, status: 'confirmed', simulated: true },
    { id: ++state.seq, user_id: 1, module_id: 'module_3', tx_hash: '', token_id: null, status: 'pending', simulated: false },
    { id: ++state.seq, user_id: 1, module_id: 'module_4', tx_hash: '', token_id: null, status: 'failed', simulated: false }
  );
  svcStub._verifyCalls = [];
  const vReq = reqFor(1);
  vReq.params.walletAddress = '0xUSER';
  r = res();
  await sbtController.verifySBT(vReq, r);
  check('blockchain mode reported', r.body.blockchain && r.body.blockchain.mode === 'simulated', r.body.blockchain);
  check('failed rows excluded from public verify', r.body.sbts.length === 3 && r.body.sbts.every((s) => s.status !== 'failed'), r.body.sbts.length);
  check('real row cross-checked on-chain', r.body.sbts[0].onChain.checked === true && r.body.sbts[0].onChain.valid === true, r.body.sbts[0].onChain);
  check('simulated row reported as simulated_mint', r.body.sbts[1].onChain.reason === 'simulated_mint', r.body.sbts[1].onChain);
  check('pending row reported as mint_pending (not checked)', r.body.sbts[2].onChain.reason === 'mint_pending', r.body.sbts[2].onChain);
  check('service consulted for every confirmed row (simulated guard lives in service)', svcStub._verifyCalls.length === 2, svcStub._verifyCalls.length);

  // =====================================================================
  console.log('\n----------------------------------------');
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('BLOCKCHAIN SMOKE TEST OK');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE TEST CRASHED:', e);
  process.exit(1);
});
