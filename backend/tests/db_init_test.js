/**
 * dbInit smoke test: runs initializeDatabase() against a stubbed pg client
 * and asserts the migration control flow — transaction begin/commit, one-time
 * ledger migrations (including credential_ids_v1), and the Phase 3 credential
 * schema statements. No live database required.
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

const executed = [];
const ledgerSelects = [];
let released = false;

const client = {
  async query(text) {
    const q = String(text).replace(/\s+/g, ' ').trim();
    executed.push(q);
    const ledger = q.match(/SELECT 1 FROM schema_migrations WHERE name = '([^']+)'/);
    if (ledger) {
      ledgerSelects.push(ledger[1]);
      return { rows: [] }; // fresh DB: nothing applied yet
    }
    if (q.startsWith('SELECT 1 FROM pg_constraint')) {
      return { rows: [{ 1: 1 }] }; // constraint already exists -> no re-create
    }
    return { rows: [] };
  },
  release() { released = true; },
};

const dbPath = path.join(backend, 'src', 'utils', 'db.js');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { async connect() { return client; } }, query: async () => ({ rows: [] }) },
};

const { initializeDatabase } = require(path.join(backend, 'src', 'utils', 'dbInit.js'));

(async () => {
  section('T1 initializeDatabase runs clean on a fresh DB');
  await initializeDatabase();
  check('client released', released === true, released);
  check('transaction committed', executed.includes('COMMIT'), null);
  check('no rollback', !executed.includes('ROLLBACK'), null);
  check('users table created', executed.some((q) => q.startsWith('CREATE TABLE IF NOT EXISTS users (')), null);
  check('user_sbts table created', executed.some((q) => q.startsWith('CREATE TABLE IF NOT EXISTS user_sbts (')), null);

  section('T2 Phase 3 credential schema statements');
  const hasAlter = (fragment) => executed.some((q) => q.includes(fragment));
  check('credential_id column (UUID default gen_random_uuid)',
    hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS credential_id UUID DEFAULT gen_random_uuid()'), null);
  check('credential_status column',
    hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS credential_status VARCHAR(20)'), null);
  check('revoked_at column', hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP'), null);
  check('revoked_by_wallet column', hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoked_by_wallet VARCHAR(255)'), null);
  check('revoke_reason column', hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoke_reason TEXT'), null);
  check('submitted_at column', hasAlter('ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP'), null);
  check('unique index on credential_id',
    executed.some((q) => q.startsWith('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sbts_credential_id')), null);

  section('T3 one-time ledger migrations all run on fresh DB');
  check('all four migrations consulted exactly once',
    ledgerSelects.filter((n) => n === 'credential_ids_v1').length === 1 &&
    ledgerSelects.filter((n) => n === 'hashed_sessions_v1').length === 1 &&
    ledgerSelects.filter((n) => n === 'legacy_quiz_source_v1').length === 1 &&
    ledgerSelects.filter((n) => n === 'sbt_legacy_simulated_v1').length === 1,
    ledgerSelects);
  check('credential_ids_v1 backfill executed',
    hasAlter('UPDATE user_sbts SET credential_id = gen_random_uuid() WHERE credential_id IS NULL'), null);
  check('credential_ids_v1 recorded in ledger',
    executed.some((q) => q.startsWith(`INSERT INTO schema_migrations (name) VALUES ('credential_ids_v1')`)), null);
  check('legacy migrations recorded too',
    executed.some((q) => q.includes("VALUES ('hashed_sessions_v1')")) &&
    executed.some((q) => q.includes("VALUES ('legacy_quiz_source_v1')")) &&
    executed.some((q) => q.includes("VALUES ('sbt_legacy_simulated_v1')")), null);

  console.log('\n----------------------------------------');
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('DB INIT SMOKE TEST OK');
  process.exit(0);
})().catch((e) => {
  console.error('DB INIT TEST CRASHED:', e);
  process.exit(1);
});
