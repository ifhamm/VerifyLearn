/**
 * Mint watcher — resolves credentials that are stuck mid-flight.
 *
 * Two states need supervision (see mint lifecycle in sbtController):
 *
 *   'submitted' — a real tx was broadcast and its hash recorded, but the
 *                 HTTP request gave up waiting (or the process died) before
 *                 the receipt arrived. We poll the receipt and finish the row.
 *
 *   'pending'   — no hash was ever recorded (crash between broadcast and hash
 *                 write, or a hang before broadcast). In real mode we ask the
 *                 contract hasMinted(wallet, moduleId): if the chain says
 *                 minted, the record is RECOVERED as confirmed-without-hash
 *                 (verification then runs through the hasMinted path — an
 *                 honest, fully-verifiable record, just without an explorer
 *                 link); if the chain says no, the tx never landed and the row
 *                 is marked failed so the user can retry cleanly.
 *
 * Honesty rules:
 *   - RPC errors leave rows UNTOUCHED (a node being unreachable says nothing).
 *   - A timeout is not a failure: 'submitted' rows are only failed after a
 *     generous window, and only when the node positively reports the tx as
 *     reverted/unknown.
 *   - We never invent a transaction hash or a token id.
 *
 * Env:
 *   MINT_WATCHER_DISABLED=true        — turn the background job off
 *   MINT_WATCHER_INTERVAL_MS          — poll interval (default 30000)
 *   MINT_PENDING_TIMEOUT_MS           — when a hashless pending row is stale (default 10 min)
 *   MINT_SUBMITTED_TIMEOUT_MS         — when an unconfirmed submitted row is failed (default 15 min)
 */
const db = require('../utils/db');
const blockchainService = require('./blockchainService');

const DEFAULTS = {
  intervalMs: 30000,
  pendingTimeoutMs: 10 * 60 * 1000,
  submittedTimeoutMs: 15 * 60 * 1000,
};

function readTimeout(envName, fallback) {
  const parsed = parseInt(process.env[envName], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig() {
  return {
    intervalMs: readTimeout('MINT_WATCHER_INTERVAL_MS', DEFAULTS.intervalMs),
    pendingTimeoutMs: readTimeout('MINT_PENDING_TIMEOUT_MS', DEFAULTS.pendingTimeoutMs),
    submittedTimeoutMs: readTimeout('MINT_SUBMITTED_TIMEOUT_MS', DEFAULTS.submittedTimeoutMs),
  };
}

function ageOf(row, now) {
  const stamp = row.submitted_at || row.minted_at;
  const parsed = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(parsed)) return NaN; // unknown age — never guess
  return now - parsed;
}

async function markFailed(row, report, reason) {
  await db.query(`UPDATE user_sbts SET status = 'failed' WHERE id = $1`, [row.id]);
  report.failed += 1;
  console.warn(`[MintWatcher] Row ${row.id} (${row.module_id}) marked failed: ${reason}`);
}

async function handleSubmitted(row, now, report, config) {
  if (!row.tx_hash) {
    // Should not happen (submitted implies a hash) — treat as hashless.
    return handlePending(row, now, report, config);
  }

  const age = ageOf(row, now);
  const mode = blockchainService.getMode();
  const realChain = mode === 'real' && blockchainService.isConfigured();

  if (!realChain) {
    if (Number.isFinite(age) && age > config.submittedTimeoutMs) {
      await markFailed(row, report, 'no real chain configured to confirm against');
    } else {
      report.pending += 1;
    }
    return;
  }

  const status = await blockchainService.getMintStatus(row.tx_hash); // throws → caller leaves row alone

  if (status.state === 'confirmed') {
    await db.query(
      `UPDATE user_sbts
       SET status = 'confirmed', token_id = COALESCE($1, token_id), simulated = FALSE, minted_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status.tokenId, row.id]
    );
    report.confirmed += 1;
    console.log(`[MintWatcher] Row ${row.id} confirmed from receipt ${row.tx_hash}.`);
    return;
  }

  if (status.state === 'reverted') {
    // A reverted tx is definitively dead — no need to wait for a timeout.
    await markFailed(row, report, `tx ${row.tx_hash} reverted on-chain`);
    return;
  }

  // 'pending' (in mempool) or 'not_found' (dropped) — only fail once stale.
  if (Number.isFinite(age) && age > config.submittedTimeoutMs) {
    await markFailed(row, report, `not confirmed within ${config.submittedTimeoutMs}ms (${status.state})`);
  } else {
    report.pending += 1;
  }
}

async function handlePending(row, now, report, config) {
  const age = ageOf(row, now);
  if (!Number.isFinite(age) || age <= config.pendingTimeoutMs) {
    report.pending += 1; // still young — a mint may be actively in flight
    return;
  }

  const mode = blockchainService.getMode();
  const realChain = mode === 'real' && blockchainService.isConfigured();

  if (!realChain) {
    await markFailed(row, report, 'stale pending row with no real chain to reconcile against');
    return;
  }

  // Reconcile against the contract — throws on RPC failure → row untouched.
  const minted = await blockchainService.hasMintedOnChain(row.wallet_address, row.module_id);

  if (minted === true) {
    // The chain says this credential exists; recover it honestly: confirmed,
    // simulated=false, but with no fabricated hash or token id.
    await db.query(
      `UPDATE user_sbts
       SET status = 'confirmed', simulated = FALSE, minted_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id]
    );
    report.recovered += 1;
    console.warn(
      `[MintWatcher] Row ${row.id} RECOVERED: contract confirms ${row.module_id} was minted for ${row.wallet_address}, but no tx hash was recorded.`
    );
    return;
  }

  await markFailed(row, report, 'chain confirms this module was never minted');
}

/**
 * One sweep. `now` is injectable for tests. Returns a report of what changed.
 * Never throws for row-level problems; a whole-sweep failure (e.g. the query
 * itself) propagates to tick().
 */
async function processStuckMints(now = Date.now()) {
  const config = getConfig();
  const report = { confirmed: 0, recovered: 0, failed: 0, pending: 0 };

  const result = await db.query(
    `SELECT s.id, s.user_id, s.module_id, s.tx_hash, s.status, s.simulated,
            s.token_id, s.submitted_at, s.minted_at, u.wallet_address
     FROM user_sbts s
     JOIN users u ON u.id = s.user_id
     WHERE s.status IN ('pending', 'submitted')`
  );

  for (const row of result.rows) {
    try {
      if (row.status === 'submitted') {
        await handleSubmitted(row, now, report, config);
      } else {
        await handlePending(row, now, report, config);
      }
    } catch (err) {
      // RPC/DB hiccup for THIS row: leave it exactly as it is and try again
      // next sweep. Never fail a row because we could not reach the node.
      console.error(`[MintWatcher] Row ${row.id} could not be resolved this sweep (left untouched):`, err.message);
    }
  }

  return report;
}

let timer = null;
let sweeping = false;

async function tick() {
  if (sweeping) return; // never overlap sweeps
  sweeping = true;
  try {
    const report = await processStuckMints();
    const changed = report.confirmed + report.recovered + report.failed;
    if (changed > 0) {
      console.log(
        `[MintWatcher] sweep: confirmed=${report.confirmed} recovered=${report.recovered} failed=${report.failed} still-pending=${report.pending}`
      );
    }
  } catch (err) {
    console.error('[MintWatcher] sweep failed:', err.message);
  } finally {
    sweeping = false;
  }
}

function start() {
  if (process.env.MINT_WATCHER_DISABLED === 'true') {
    console.log('[MintWatcher] Disabled via MINT_WATCHER_DISABLED=true.');
    return;
  }
  if (timer) return;
  const { intervalMs } = getConfig();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref(); // never hold the process open
  console.log(`[MintWatcher] Started (every ${intervalMs}ms).`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[MintWatcher] Stopped.');
  }
}

module.exports = { start, stop, processStuckMints, getConfig };
