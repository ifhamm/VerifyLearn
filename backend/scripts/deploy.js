/**
 * Deploys VerifyLearnSBT.sol to the configured network (default: Sepolia).
 *
 * Run from backend/:   node scripts/deploy.js
 *
 * Reads the ROOT .env: RPC_URL (defaults to Sepolia public node),
 * SYSTEM_PRIVATE_KEY (the deployer wallet).
 * The private key is used in-process only — this script never prints it.
 * After a successful deploy it writes SBT_CONTRACT_ADDRESS (a PUBLIC value)
 * into the root .env; nothing else in the file is modified.
 *
 * Requirements:
 *   - deployer wallet funded with testnet ETH (Sepolia faucet)
 *   - dev dependencies installed (npm ci) — solc compiles the contract locally
 *
 * Alternative without this script: Remix IDE (see readme, "Deploying the SBT
 * contract") — paste contracts/VerifyLearnSBT.sol, compile, deploy.
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const solc = require('solc');

// Same root .env location the backend app uses
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ENV_PATH = path.resolve(__dirname, '../../.env');
const CONTRACT_FILE = path.resolve(__dirname, '../contracts/VerifyLearnSBT.sol');
const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

// Persist the DEPLOYED ADDRESS (a public value, never a secret) into the root
// .env so the backend picks it up on restart. Keys are never touched.
function recordContractAddress(address) {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('[Deploy] No root .env found — add this line manually:');
    console.log(`        SBT_CONTRACT_ADDRESS=${address}`);
    return false;
  }
  let envContent = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^SBT_CONTRACT_ADDRESS=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^SBT_CONTRACT_ADDRESS=.*$/m, `SBT_CONTRACT_ADDRESS=${address}`);
  } else {
    envContent += `${envContent.endsWith('\n') || envContent === '' ? '' : '\n'}SBT_CONTRACT_ADDRESS=${address}\n`;
  }
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log(`[Deploy] SBT_CONTRACT_ADDRESS updated in ${ENV_PATH}`);
  return true;
}

function fail(message) {
  console.error('\n[Deploy] FAILED:', message);
  process.exit(1);
}

function compile() {
  const source = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'VerifyLearnSBT.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  console.log('[Deploy] Compiling VerifyLearnSBT.sol with solc', solc.version().split('+')[0], '...');
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length > 0) {
    fail('Compilation errors:\n' + errors.map((e) => e.formattedMessage).join('\n'));
  }
  const warnings = (output.errors || []).filter((e) => e.severity === 'warning');
  warnings.forEach((w) => console.warn('[Deploy] Compiler warning:', w.formattedMessage));

  const contract = output.contracts['VerifyLearnSBT.sol']['VerifyLearnSBT'];
  if (!contract || !contract.evm.bytecode.object) {
    fail('Compiler produced no bytecode — unexpected.');
  }
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

async function main() {
  const rpcUrl = process.env.RPC_URL || DEFAULT_RPC;
  const privateKey = process.env.SYSTEM_PRIVATE_KEY;

  const missing = [];
  if (!privateKey) missing.push('SYSTEM_PRIVATE_KEY');
  if (missing.length > 0) {
    fail(
      `Missing in .env (root): ${missing.join(', ')}\n` +
        `  SYSTEM_PRIVATE_KEY    deployer wallet key (0x + 64 hex). Keep it secret.\n` +
        `  RPC_URL               optional — defaults to ${DEFAULT_RPC}`
    );
  }

  const { abi, bytecode } = compile();

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  let network;
  try {
    network = await provider.getNetwork();
  } catch (e) {
    fail(`Cannot reach RPC endpoint: ${e.shortMessage || e.message}`);
  }

  // Accept keys with or without the 0x prefix (MetaMask exports both forms)
  const normalizedKey = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const wallet = new ethers.Wallet(normalizedKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`[Deploy] Network:  ${network.name} (chainId ${network.chainId})`);
  console.log(`[Deploy] Deployer: ${wallet.address}`);

  if (balance === 0n) {
    fail(
      `Deployer wallet has zero balance on chainId ${network.chainId}.\n` +
        `  Fund it from a faucet first, then re-run:\n` +
        `    - https://faucets.chain.link/sepolia\n` +
        `    - https://sepolia-faucet.pk910.de/\n` +
        `  Balance: 0 ETH`
    );
  }
  console.log(`[Deploy] Balance:  ${ethers.formatEther(balance)} ETH`);

  console.log('[Deploy] Sending deployment transaction...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  console.log(`[Deploy] Tx hash:  ${deployTx.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await deployTx.wait();

  // Confirm bytecode actually landed at the address before claiming success
  const code = await provider.getCode(address);
  if (!code || code === '0x') {
    fail('No bytecode found at the computed address — deployment did not persist.');
  }

  const explorer = (process.env.EXPLORER_URL || 'https://sepolia.etherscan.io').replace(/\/+$/, '');

  console.log('\n========================================');
  console.log('VerifyLearnSBT deployed successfully!');
  console.log(`  Address:  ${address}`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Explorer: ${explorer}/address/${address}`);
  console.log('========================================');

  recordContractAddress(address);

  console.log('\nNext steps:');
  console.log('  1. Allow yourself to revoke credentials (comma-separated wallets):');
  console.log('       ADMIN_WALLETS=<your wallet address>      # add to root .env');
  console.log('  2. Real mode (production defaults to it; in dev set explicitly):');
  console.log('       BLOCKCHAIN_MODE=real                     # add to root .env');
  console.log('  3. Restart the backend:');
  console.log('       docker restart verify-learn-backend      # (or npm run dev)');
  console.log('  4. Mint a credential — it now hits the chain above for real.');
}

main().catch((err) => {
  fail(err.shortMessage || err.message || String(err));
});
