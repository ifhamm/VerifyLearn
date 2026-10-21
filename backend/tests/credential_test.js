/**
 * Credential Share Pack smoke test — public credential API, W3C-style VC
 * export (with a REAL EIP-191 signature verified with ethers), and QR
 * generation. Uses a stubbed db + blockchainService and no live network.
 */
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('ethers');
const backend = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, actual !== undefined ? JSON.stringify(actual) : ''); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

// A throwaway issuer key so the proof path runs for real.
const ISSUER_KEY = '0x' + crypto.randomBytes(32).toString('hex');
const issuerWallet = new ethers.Wallet(ISSUER_KEY);
process.env.SYSTEM_PRIVATE_KEY = ISSUER_KEY;
process.env.SBT_CONTRACT_ADDRESS = '0x' + '11'.repeat(20);
process.env.BASE_URL = 'https://verifylearn.test';

const state = {
  rows: [],
  scores: [],
};

function mockQuery(text, params = []) {
  const q = text.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT s.id, s.credential_id, s.module_id, s.tx_hash, s.token_id, s.minted_at')) {
    const row = state.rows.find((r) => String(r.credential_id) === String(params[0]));
    return { rows: row ? [{ ...row }] : [] };
  }
  if (q.startsWith('SELECT score, total_questions, correct_answers, created_at FROM quiz_results')) {
    const score = state.scores.find((s) => String(s.material_slug) === String(params[1]));
    return { rows: score ? [{ ...score }] : [] };
  }
  throw new Error('fake db: unhandled query -> ' + q);
}

const dbPath = path.join(backend, 'src', 'utils', 'db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: mockQuery, pool: {} } };

const svcPath = path.join(backend, 'src', 'services', 'blockchainService.js');
const svcStub = {
  _mode: 'real',
  _verifyImpl: () => ({ checked: true, valid: true, mode: 'real', owner: '0xUSER', chainId: 11155111, explorerUrl: 'https://sepolia.etherscan.io/tx/0xdead' }),
  getMode: () => svcStub._mode,
  verifyOnChain: async (proof) => svcStub._verifyImpl(proof),
};
require.cache[svcPath] = { id: svcPath, filename: svcPath, loaded: true, exports: svcStub };

const credentialController = require(path.join(backend, 'src', 'controllers', 'credentialController.js'));

function res() {
  return {
    statusCode: 200, body: null, typeValue: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    type(t) { this.typeValue = t; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    send(b) { this.body = b; return this; },
  };
}
function req(credentialId) {
  return { params: { credentialId }, protocol: 'https', get: () => 'verifylearn.test' };
}

const baseRow = (over) => Object.assign({
  id: 1,
  credential_id: '11111111-1111-1111-1111-111111111111',
  module_id: 'module_1',
  tx_hash: '0x' + 'ab'.repeat(32),
  token_id: 7,
  minted_at: '2026-01-02T03:04:05.000Z',
  status: 'confirmed',
  simulated: false,
  credential_status: 'active',
  revoked_at: null,
  revoked_by_wallet: null,
  revoke_reason: null,
  username: 'learner',
  wallet_address: '0xUSER',
  integrity_score: 88,
}, over || {});

(async () => {
  section('T1 public credential detail');
  state.rows.push(baseRow({}));
  state.scores.push({ material_slug: 'quiz-module-1', score: 8, total_questions: 10, correct_answers: 8, created_at: '2026-01-01T00:00:00.000Z' });

  let r = res();
  await credentialController.getCredential(req(baseRow().credential_id), r);
  check('found credential => 200', r.statusCode === 200, r.statusCode);
  check('module title resolved', r.body.credential.moduleTitle.startsWith('Module 1'), r.body.credential.moduleTitle);
  check('holder wallet shortened for display', r.body.holder.walletShort === '0xUSER', r.body.holder.walletShort);
  check('score attached from server-graded quiz', r.body.credential.score && r.body.credential.score.score === 8, r.body.credential.score);
  check('on-chain check surfaced', r.body.blockchain.onChain.checked === true && r.body.blockchain.onChain.valid === true, r.body.blockchain.onChain);
  check('verify URL uses BASE_URL', r.body.verifyUrl === 'https://verifylearn.test/verify/c/' + baseRow().credential_id, r.body.verifyUrl);
  check('qr URL derived from verify URL', r.body.qrUrl === r.body.verifyUrl + '/qr.png', r.body.qrUrl);
  check('active credential reports no revocation', r.body.credential.revocation === null, r.body.credential.revocation);

  section('T2 unknown / failed credentials are not shareable');
  r = res();
  await credentialController.getCredential(req('99999999-9999-9999-9999-999999999999'), r);
  check('unknown id => 404', r.statusCode === 404, r.statusCode);

  state.rows.push(baseRow({ credential_id: '22222222-2222-2222-2222-222222222222', status: 'failed' }));
  r = res();
  await credentialController.getCredential(req('22222222-2222-2222-2222-222222222222'), r);
  check('failed mint => 404 (never a credential)', r.statusCode === 404, r.statusCode);

  section('T3 revoked credential stays visible and says so');
  state.rows.push(baseRow({
    credential_id: '33333333-3333-3333-3333-333333333333',
    credential_status: 'revoked',
    revoked_at: '2026-02-01T00:00:00.000Z',
    revoke_reason: 'issued by mistake',
  }));
  r = res();
  await credentialController.getCredential(req('33333333-3333-3333-3333-333333333333'), r);
  check('revoked credential still resolves (stale links keep working)', r.statusCode === 200, r.statusCode);
  check('status reported as revoked', r.body.credential.status === 'revoked', r.body.credential.status);
  check('revocation reason disclosed', r.body.credential.revocation && r.body.credential.revocation.reason === 'issued by mistake', r.body.credential.revocation);

  section('T4 simulated credential is labelled, never presented as on-chain');
  svcStub._verifyImpl = () => ({ checked: false, valid: false, mode: 'simulated', reason: 'simulated_mint', explorerUrl: null });
  state.rows.push(baseRow({ credential_id: '44444444-4444-4444-4444-444444444444', simulated: true, tx_hash: '', token_id: null }));
  r = res();
  await credentialController.getCredential(req('44444444-4444-4444-4444-444444444444'), r);
  check('simulated flag surfaced', r.body.credential.simulated === true, r.body.credential.simulated);
  check('on-chain invalid with simulated_mint reason', r.body.blockchain.onChain.valid === false && r.body.blockchain.onChain.reason === 'simulated_mint', r.body.blockchain.onChain);
  check('empty tx hash returned as null (no fake hash)', r.body.blockchain.txHash === null, r.body.blockchain.txHash);

  section('T5 W3C-style VC export');
  svcStub._verifyImpl = () => ({ checked: true, valid: true, mode: 'real', chainId: 11155111 });
  r = res();
  await credentialController.getCredentialVC(req(baseRow().credential_id), r);
  const vc = r.body;
  check('media type is application/ld+json', r.typeValue === 'application/ld+json', r.typeValue);
  check('@context + type present', Array.isArray(vc['@context']) && vc.type.includes('VerifiableCredential') && vc.type.includes('VerifyLearnCredential'), vc.type);
  check('id is a urn:uuid of the credential id', vc.id === 'urn:uuid:' + baseRow().credential_id, vc.id);
  check('issuer identifies the contract', vc.issuer.id === 'urn:ethereum:' + process.env.SBT_CONTRACT_ADDRESS, vc.issuer);
  check('issuanceDate is ISO', vc.issuanceDate === '2026-01-02T03:04:05.000Z', vc.issuanceDate);
  check('subject carries the holder wallet + achievement', vc.credentialSubject.id === '0xUSER' && vc.credentialSubject.achievement.moduleId === 'module_1', vc.credentialSubject);
  check('credentialStatus reflects active', vc.credentialStatus.status === 'active', vc.credentialStatus);
  check('provenance explicitly states on-chain + not simulated', vc.provenance.simulated === false && vc.provenance.onChainValid === true, vc.provenance);

  section('T6 issuer proof is a real, verifiable EIP-191 signature');
  check('proof type + purpose declared', vc.proof.type === 'Eip191Signature' && vc.proof.proofPurpose === 'assertionMethod', vc.proof);
  check('proofValue present', typeof vc.proof.proofValue === 'string' && vc.proof.proofValue.startsWith('0x'), vc.proof.proofValue);
  // Recompute the canonical digest the way the controller does and verify.
  const canonical = JSON.stringify({
    id: vc.id.replace('urn:uuid:', ''),
    moduleId: 'module_1',
    subject: '0xuser',
    issuanceDate: '2026-01-02T03:04:05.000Z',
    txHash: '0x' + 'ab'.repeat(32),
    contractAddress: process.env.SBT_CONTRACT_ADDRESS,
    chainId: 11155111,
  });
  const digest = '0x' + crypto.createHash('sha256').update(canonical).digest('hex');
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), vc.proof.proofValue);
  check('signature recovers to the configured issuer wallet', recovered === issuerWallet.address, { recovered, expected: issuerWallet.address });
  check('canonicalizationHash matches the recomputed digest', vc.proof.canonicalizationHash === digest, { got: vc.proof.canonicalizationHash, want: digest });
  check('verificationMethod names the issuer address', vc.proof.verificationMethod === 'urn:ethereum:' + issuerWallet.address, vc.proof.verificationMethod);

  section('T7 VC for a revoked credential is honest');
  r = res();
  await credentialController.getCredentialVC(req('33333333-3333-3333-3333-333333333333'), r);
  check('revoked status propagates into the VC', r.body.credentialStatus.status === 'revoked', r.body.credentialStatus);

  section('T8 QR code endpoint');
  r = res();
  await credentialController.getCredentialQR(req(baseRow().credential_id), r);
  check('returns PNG', r.typeValue === 'png', r.typeValue);
  check('response is a PNG buffer (magic bytes)', Buffer.isBuffer(r.body) && r.body.slice(0, 4).toString('hex') === '89504e47', r.body && r.body.slice(0, 4).toString('hex'));
  check('cacheable', r.headers['Cache-Control'] === 'public, max-age=86400', r.headers);

  r = res();
  await credentialController.getCredentialQR(req('99999999-9999-9999-9999-999999999999'), r);
  check('unknown id => 404 (no QR for ghosts)', r.statusCode === 404, r.statusCode);

  section('T9 routes are mounted');
  const apiRoutes = require(path.join(backend, 'src', 'routes', 'apiRoutes.js'));
  const paths = apiRoutes.stack.filter((l) => l.route).map((l) => l.route.path);
  check('GET /credentials/:credentialId', paths.includes('/credentials/:credentialId'), paths.filter((p) => p.includes('credential')));
  check('GET /credentials/:credentialId/vc', paths.includes('/credentials/:credentialId/vc'), null);
  check('GET /credentials/:credentialId/qr.png', paths.includes('/credentials/:credentialId/qr.png'), null);

  console.log('\n----------------------------------------');
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('CREDENTIAL SHARE PACK TEST OK');
  process.exit(0);
})().catch((e) => {
  console.error('CREDENTIAL TEST CRASHED:', e);
  process.exit(1);
});
