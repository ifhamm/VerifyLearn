const { ethers } = require('ethers');

// Minimal ABI for VerifyLearnSBT.sol — mint plus the read methods used to
// independently verify a credential against the chain.
const SBT_ABI = [
  'function mintSBT(address to, string calldata moduleId, string calldata uri) external returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function hasMinted(address user, string calldata moduleId) external view returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'event SBTMinted(address indexed recipient, uint256 indexed tokenId, string moduleId, string tokenURI)',
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

exports.getMode = getMode;
exports.isConfigured = isConfigured;

/**
 * Mint an SBT for (recipientWallet, moduleId).
 *
 * Simulated mode: returns a clearly-marked simulated result (simulated: true).
 * Real mode: performs an actual on-chain mint. On ANY failure it THROWS a
 * typed error — there is no fallback to a mock hash. Callers must persist a
 * 'failed' status, never a fabricated transaction hash.
 */
exports.mintSBT = async (recipientWallet, moduleId) => {
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

    const receipt = await tx.wait();
    console.log(`[Blockchain] Tx confirmed in block: ${receipt.blockNumber}`);

    // Parse event logs to get the real Token ID (no random fallback)
    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog(log);
        if (parsedLog && parsedLog.name === 'SBTMinted') {
          tokenId = Number(parsedLog.args.tokenId);
          break;
        }
      } catch (e) {
        // ignore logs from other contracts
      }
    }

    return {
      transactionHash: tx.hash,
      tokenId,
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
