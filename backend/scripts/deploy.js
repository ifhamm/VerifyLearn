/**
 * Deploys VerifyLearnSBT.sol to the configured network (default: Sepolia).
 *
 * Run from backend/:   node scripts/deploy.js
 *
 * Reads the ROOT .env: RPC_URL, SYSTEM_PRIVATE_KEY (the deployer wallet).
 * The private key is used in-process only — this script never prints it and
 * never writes to any file.
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

const CONTRACT_FILE = path.resolve(__dirname, '../contracts/VerifyLearnSBT.sol');

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
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.SYSTEM_PRIVATE_KEY;

  const missing = [];
  if (!rpcUrl) missing.push('RPC_URL');
  if (!privateKey) missing.push('SYSTEM_PRIVATE_KEY');
  if (missing.length > 0) {
    fail(
      `Missing in .env (root): ${missing.join(', ')}\n` +
        `  RPC_URL               e.g. https://ethereum-sepolia-rpc.publicnode.com\n` +
        `  SYSTEM_PRIVATE_KEY    deployer wallet key (0x + 64 hex). Keep it secret.`
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

  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`[Deploy] Network:  ${network.name} (chainId ${network.chainId})`);
  console.log(`[Deploy] Deployer: ${wallet.address}`);

  if (balance === 0n) {
    fail(
      `Deployer wallet has zero balance on chainId ${network.chainId}.\n` +
        `  Fund it from a faucet first (search "Sepolia faucet"), then re-run.\n` +
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
  console.log('\nNext steps:');
  console.log('  1. Add to .env (root):');
  console.log(`       SBT_CONTRACT_ADDRESS=${address}`);
  console.log('  2. Allow yourself to revoke credentials (comma-separated wallets):');
  console.log('       ADMIN_WALLETS=<your wallet address>');
  console.log('  3. Real mode (production defaults to it; in dev set explicitly):');
  console.log('       BLOCKCHAIN_MODE=real');
  console.log('  4. Restart the backend. Minting will now hit the chain above.');
}

main().catch((err) => {
  fail(err.shortMessage || err.message || String(err));
});
