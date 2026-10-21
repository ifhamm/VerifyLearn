const { ethers } = require('ethers');

// Minimal ABI for VerifyLearnSBT.sol — mint, revoke and the read methods
// used to independently verify a credential against the chain.
const SBT_ABI = [
  'function mintSBT(address to, string calldata moduleId, string calldata uri) external returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function hasMinted(address user, string calldata moduleId) external view returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function revoke(uint256 tokenId, string calldata reason) external',
  'function revoked(uint256 tokenId) external view returns (bool)',
  'event SBTMinted(address indexed recipient, uint256 indexed tokenId, string moduleId, string tokenURI)',
  'event Revoked(uint256 indexed tokenId, address indexed revokedBy, string reason)',
];

const DEFAULT_EXPLORER_URL = 'https://sepolia.etherscan.io';

function isConfigured() {
  return !!(
    process.env.RPC_URL &&
    process.env.SYSTEM_PRIVATE_KEY &&
    process.env.SBT_CONTRACT_ADDRESS
  );
}

// Resolve the operating mode. Order of precedence:
//   1. Explicit BLOCKCHAIN_MODE=real|simulated always wins.
//   2. APP_ENV=production => always 'real' (a missing config is an ERROR,
//      never a silent fallback to fabricated hashes).
//   3. Development: 'real' when fully configured, 'simulated' otherwise.
function getMode() {
  const explicit = (process.env.BLOCKCHAIN_MODE || '').toLowerCase().trim();
  if (explicit === 'real' || explicit === 'simulated') return explicit;
  if ((process.env.APP_ENV || 'development') === 'production') return 'real';
  return isConfigured() ? 'real' : 'simulated';
}

function getExplorerBase() {
  return (process.env.EXPLORER_URL || DEFAULT_EXPLORER_URL).replace(/\/+$/, '');
}

// Typed error so the controller can map failures to honest responses
// (502, status 'failed') instead of fabricating a result.
function blockchainError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Dev-only helper: deterministic-looking mock hash for SIMULATED mode.
function generateMockTxHash() {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

function getContract(signerOrProvider) {
  return new ethers.Contract(process.env.SBT_CONTRACT_ADDRESS, SBT_ABI, signerOrProvider);
}

// Race a promise against a deadline. On timeout, rejects with a typed
// WAIT_TIMEOUT error (unref'd timer so a pending race never blocks exit).
function raceWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(blockchainError('WAIT_TIMEOUT', `${label} timed out after ${ms}ms`));
    }, ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Pull the real Token ID out of an SBTMinted event log (null if not found —
// never a random fallback; callers treat null as "tokenId unknown").
function extractTokenIdFromReceipt(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const log of receipt.logs) {
    try {
      const parsedLog = getContract().interface.parseLog(log);
      if (parsedLog && parsedLog.name === 'SBTMinted') {
        return Number(parsedLog.args.tokenId);
      }
    } catch (e) {
      // ignore logs from other contracts
    }
  }
  return null;
}

exports.getMode = getMode;
exports.isConfigured = isConfigured;

/**
 * Mint an SBT for (recipientWallet, moduleId).
 *
 * Simulated mode: returns a clearly-marked simulated result (simulated: true).
 * Real mode: performs an actual on-chain mint. The tx hash is handed to
 * opts.onSubmitted(hash) the moment the tx is sent (so a crash during
 * confirmation still leaves a recoverable record). If confirmation does not
 * arrive within MINT_WAIT_TIMEOUT_MS, the result status is 'submitted'
 * (NOT a failure — the watcher resolves it later). On ANY definite failure
 * it THROWS a typed error — there is no fallback to a mock hash. Callers
 * must persist a 'failed' status, never a fabricated transaction hash.
 */
const MINT_WAIT_TIMEOUT_MS = parseInt(process.env.MINT_WAIT_TIMEOUT_MS, 10) || 45000;

exports.mintSBT = async (recipientWallet, moduleId, opts = {}) => {
  const mode = getMode();
  const metadataURI = `https://api.verifylearn.com/metadata/sbt/${moduleId}`;

  if (mode === 'simulated') {
    console.log(
      `[Blockchain] BLOCKCHAIN_MODE=simulated — recording DEV-ONLY credential for ${recipientWallet}, module ${moduleId} (NOT on-chain)`
    );
    await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate settlement delay
    return {
      transactionHash: generateMockTxHash(),
      tokenId: Math.floor(Math.random() * 900) + 101, // Random ID between 101 and 1000
      status: 'confirmed',
      simulated: true,
    };
  }

  // mode === 'real' from here on: succeed fully or throw.
  if (!isConfigured()) {
    throw blockchainError(
      'NOT_CONFIGURED',
      'BLOCKCHAIN_MODE=real but RPC_URL, SYSTEM_PRIVATE_KEY and SBT_CONTRACT_ADDRESS are not all set.'
    );
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.SYSTEM_PRIVATE_KEY, provider);
    const contract = getContract(wallet);

    const tx = await contract.mintSBT(recipientWallet, moduleId, metadataURI);
    console.log(`[Blockchain] Tx sent: ${tx.hash}. Waiting for confirmation...`);

    // Hand the hash to the caller IMMEDIATELY: if this process crashes while
    // waiting, the record still holds a resolvable on-chain reference (the
    // watcher picks it up from status='submitted'). Callback errors must not
    // kill an already-broadcast tx — log loudly and continue.
    if (typeof opts.onSubmitted === 'function') {
      try {
        await opts.onSubmitted(tx.hash);
      } catch (e) {
        console.error(
          '[Blockchain] onSubmitted callback failed — tx is on-chain but the record may lack the hash:',
          e.message
        );
      }
    }

    // Confirmation does not always arrive inside this process's lifetime.
    // A timeout is NOT a failure (the tx may confirm a second later) — it
    // returns status 'submitted' so the watcher can resolve the receipt.
    let receipt;
    try {
      receipt = await raceWithTimeout(tx.wait(), MINT_WAIT_TIMEOUT_MS, 'mint confirmation');
    } catch (waitErr) {
      if (waitErr && waitErr.code === 'WAIT_TIMEOUT') {
        console.warn(
          `[Blockchain] Confirmation still pending after ${MINT_WAIT_TIMEOUT_MS}ms — handing off to mint watcher.`
        );
        return {
          transactionHash: tx.hash,
          tokenId: null,
          status: 'submitted',
          simulated: false,
        };
      }
      throw waitErr; // revert / RPC failure → handled by the outer catch
    }
    console.log(`[Blockchain] Tx confirmed in block: ${receipt.blockNumber}`);

    return {
      transactionHash: tx.hash,
      tokenId: extractTokenIdFromReceipt(receipt),
      status: 'confirmed',
      simulated: false,
    };
  } catch (err) {
    console.error('[Blockchain] On-chain mint failed:', err);
    throw blockchainError('ONCHAIN_FAILED', 'The on-chain mint transaction failed.');
  }
};

/**
 * Cross-check a stored credential against the real chain.
 *
 * Never throws. Always reports what was (and was not) checked so callers
 * cannot mistake an unverified record for a verified one:
 *   { checked, valid, mode, reason?, owner?, tokenURI?, contractAddress?, explorerUrl? }
 *
 * Checks performed (real mode, fully configured):
 *   - contract bytecode actually deployed at SBT_CONTRACT_ADDRESS
 *   - ownerOf(tokenId) matches the expected wallet (or hasMinted(user, moduleId))
 *   - tokenURI(tokenId) readable
 *   - explorer link for the recorded tx hash
 */
exports.verifyOnChain = async ({ walletAddress, moduleId, tokenId, txHash, simulated } = {}) => {
  const mode = getMode();
  const explorerBase = getExplorerBase();
  const contractAddress = process.env.SBT_CONTRACT_ADDRESS;
  const explorerUrl = txHash ? `${explorerBase}/tx/${txHash}` : null;

  // A record we KNOW was never on-chain must not be presented as verified.
  if (simulated === true) {
    return { checked: false, valid: false, mode, reason: 'simulated_mint', explorerUrl: null };
  }
  if (mode !== 'real') {
    return { checked: false, valid: false, mode, reason: 'not_real_mode', explorerUrl: null };
  }
  if (!isConfigured()) {
    return { checked: false, valid: false, mode, reason: 'not_configured', explorerUrl: null };
  }
  if (
    (tokenId === null || tokenId === undefined) &&
    !(walletAddress && moduleId)
  ) {
    return { checked: false, valid: false, mode, reason: 'insufficient_proof', explorerUrl };
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    // 1. The contract must actually exist at the configured address
    const code = await provider.getCode(contractAddress);
    if (!code || code === '0x') {
      return {
        checked: true,
        valid: false,
        mode,
        contractAddress,
        reason: 'no_contract_code',
        explorerUrl,
      };
    }

    const contract = getContract(provider);
    const result = {
      checked: true,
      valid: true,
      mode,
      contractAddress,
      explorerUrl,
    };

    if (tokenId !== null && tokenId !== undefined) {
      // 2a. Token ownership + metadata
      let owner;
      try {
        owner = await contract.ownerOf(tokenId);
      } catch (e) {
        return {
          checked: true,
          valid: false,
          mode,
          contractAddress,
          reason: 'token_not_found',
          tokenId: Number(tokenId),
          explorerUrl,
        };
      }
      result.owner = owner;
      result.tokenId = Number(tokenId);
      try {
        result.tokenURI = await contract.tokenURI(tokenId);
      } catch (e) {
        result.tokenURI = null;
      }
      if (walletAddress && owner.toLowerCase() !== walletAddress.toLowerCase()) {
        result.valid = false;
        result.reason = 'owner_mismatch';
      }
      // Revocation state (contract v2). A v1 contract without revoke()
      // throws here — leave revoked undefined rather than claiming a status.
      try {
        result.revoked = await contract.revoked(tokenId);
        if (result.revoked === true) {
          result.valid = false;
          result.reason = 'revoked_on_chain';
        }
      } catch (e) {
        result.revoked = undefined;
      }
    } else {
      // 2b. No token id recorded — ask the contract whether it ever minted
      const minted = await contract.hasMinted(walletAddress, moduleId);
      result.minted = !!minted;
      if (!minted) {
        result.valid = false;
        result.reason = 'not_minted_on_chain';
      }
    }

    return result;
  } catch (err) {
    console.error('[Blockchain] On-chain verification RPC failed:', err);
    return { checked: false, valid: false, mode, reason: 'rpc_unavailable', explorerUrl };
  }
};

/**
 * Revoke a token on-chain (owner-only contract call).
 *
 * Guarded exactly like mint: simulated/unconfigured states return
 * { onchain: false, reason } WITHOUT touching anything; a real failure THROWS
 * (code ONCHAIN_FAILED) so the caller can leave the DB untouched too —
 * never a half-revoked state claimed as success.
 */
exports.revokeOnChain = async (tokenId, reason = '') => {
  const mode = getMode();

  if (mode !== 'real') {
    return { onchain: false, mode, reason: 'not_real_mode' };
  }
  if (!isConfigured()) {
    return { onchain: false, mode, reason: 'not_configured' };
  }
  if (tokenId === null || tokenId === undefined) {
    return { onchain: false, mode, reason: 'no_token_id' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.SYSTEM_PRIVATE_KEY, provider);
    const contract = getContract(wallet);

    const tx = await contract.revoke(Number(tokenId), String(reason || '').slice(0, 200));
    console.log(`[Blockchain] Revoke tx sent: ${tx.hash} (token ${tokenId}). Waiting...`);
    const receipt = await tx.wait();
    console.log(`[Blockchain] Revoke confirmed in block: ${receipt.blockNumber}`);

    return { onchain: true, mode, txHash: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    console.error('[Blockchain] On-chain revoke failed:', err);
    throw blockchainError('ONCHAIN_FAILED', 'The on-chain revoke transaction failed.');
  }
};

/**
 * Resolve the definitive on-chain state of a mint tx (mint watcher input).
 *
 *   { state: 'confirmed', tokenId, blockNumber }  — receipt present, success
 *   { state: 'reverted',  blockNumber }           — receipt present, failed
 *   { state: 'pending' }                          — known to the node, no receipt yet
 *   { state: 'not_found' }                        — node does not know this hash (dropped)
 *
 * THROWS on RPC failure / misconfiguration — never guesses. Callers must
 * leave records untouched when this throws (the node being down says
 * nothing about whether the tx landed).
 */
exports.getMintStatus = async (txHash) => {
  if (!txHash) throw blockchainError('NO_TX_HASH', 'No transaction hash to check.');
  if (!isConfigured()) {
    throw blockchainError('NOT_CONFIGURED', 'RPC_URL / SYSTEM_PRIVATE_KEY / SBT_CONTRACT_ADDRESS not all set.');
  }
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (receipt) {
    if (receipt.status === 1) {
      return {
        state: 'confirmed',
        tokenId: extractTokenIdFromReceipt(receipt),
        blockNumber: receipt.blockNumber,
      };
    }
    return { state: 'reverted', blockNumber: receipt.blockNumber };
  }
  const tx = await provider.getTransaction(txHash);
  return { state: tx ? 'pending' : 'not_found' };
};

/**
 * Ask the contract whether (wallet, moduleId) was ever minted — used by the
 * watcher to reconcile a record whose hash was lost (crash between broadcast
 * and hash write): chain says minted ⇒ recover as confirmed-without-hash;
 * chain says no ⇒ the tx never landed ⇒ safe to mark failed.
 * THROWS on RPC failure (same honesty contract as getMintStatus).
 */
exports.hasMintedOnChain = async (walletAddress, moduleId) => {
  if (!walletAddress || !moduleId) {
    throw blockchainError('INSUFFICIENT_PROOF', 'walletAddress and moduleId are required.');
  }
  if (!isConfigured()) {
    throw blockchainError('NOT_CONFIGURED', 'RPC_URL / SYSTEM_PRIVATE_KEY / SBT_CONTRACT_ADDRESS not all set.');
  }
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const contract = getContract(provider);
  return (await contract.hasMinted(walletAddress, moduleId)) === true;
};
