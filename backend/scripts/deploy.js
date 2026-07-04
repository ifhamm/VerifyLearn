const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  console.log('=== VerifyLearn SBT Deployment Script ===');

  // 1. Install solc dynamically if not installed
  try {
    require.resolve('solc');
  } catch (e) {
    console.log('[Info] Installing Solidity compiler (solc)... Please wait.');
    execSync('npm install --no-save solc@0.8.20', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
  }

  const solc = require('solc');
  const { ethers } = require('ethers');

  // Load .env values
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    console.error('[Error] .env file not found at project root.');
    process.exit(1);
  }

  let envContent = fs.readFileSync(envPath, 'utf8');
  const getEnvValue = (key) => {
    const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
  };

  const rpcUrl = getEnvValue('RPC_URL') || 'https://ethereum-sepolia-rpc.publicnode.com';
  const privateKey = getEnvValue('SYSTEM_PRIVATE_KEY');

  if (!privateKey) {
    console.error('[Error] SYSTEM_PRIVATE_KEY is missing in your .env file.');
    console.log('Please add your MetaMask wallet Private Key to your .env file first.');
    process.exit(1);
  }

  console.log('[1/4] Compiling VerifyLearnSBT.sol...');
  const contractPath = path.resolve(__dirname, '../contracts/VerifyLearnSBT.sol');
  if (!fs.existsSync(contractPath)) {
    console.error(`[Error] Contract file not found at: ${contractPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(contractPath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'VerifyLearnSBT.sol': {
        content: source
      }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const criticalErrors = output.errors.filter(e => e.severity === 'error');
    if (criticalErrors.length > 0) {
      console.error('[Error] Compilation failed:', criticalErrors);
      process.exit(1);
    }
  }

  const contractOutput = output.contracts['VerifyLearnSBT.sol']['VerifyLearnSBT'];
  const abi = contractOutput.abi;
  const bytecode = contractOutput.evm.bytecode.object;
  console.log('[Success] Compilation successful!');

  console.log('[2/4] Connecting to Sepolia Network...');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // Format private key (ensure it starts with 0x)
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const wallet = new ethers.Wallet(formattedPrivateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  
  console.log(`Using Wallet Address: ${wallet.address}`);
  console.log(`Wallet Balance: ${ethers.formatEther(balance)} Sepolia ETH`);

  if (balance === 0n) {
    console.error('[Error] Insufficient funds. Your wallet balance is 0 Sepolia ETH.');
    console.log('Please request free Sepolia ETH using one of these easy faucets first:');
    console.log('- https://faucets.chain.link/sepolia');
    console.log('- https://sepolia-faucet.pk910.de/');
    process.exit(1);
  }

  console.log('[3/4] Deploying VerifyLearnSBT contract to Sepolia Testnet...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  // Deploy the contract
  const contract = await factory.deploy();
  console.log(`Deployment transaction submitted. Hash: ${contract.deploymentTransaction().hash}`);
  
  console.log('Waiting for transaction confirmation... (takes ~10-15 seconds)');
  await contract.waitForDeployment();
  
  const deployedAddress = await contract.getAddress();
  console.log(`[Success] Contract deployed successfully! Address: ${deployedAddress}`);

  console.log('[4/4] Updating your .env file...');
  // Check if SBT_CONTRACT_ADDRESS already exists, update it. Otherwise append.
  if (envContent.includes('SBT_CONTRACT_ADDRESS=')) {
    envContent = envContent.replace(/^SBT_CONTRACT_ADDRESS=.*$/m, `SBT_CONTRACT_ADDRESS=${deployedAddress}`);
  } else {
    envContent += `\nSBT_CONTRACT_ADDRESS=${deployedAddress}\n`;
  }
  
  // Force ensure RPC_URL is in the file
  if (!envContent.includes('RPC_URL=')) {
    envContent += `\nRPC_URL=https://ethereum-sepolia-rpc.publicnode.com\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('[Success] .env file has been updated with your contract address!');
  console.log('\n=============================================');
  console.log('Next Steps:');
  console.log('1. Run "docker restart verify-learn-backend" to restart the backend container.');
  console.log('2. Complete your learning module and click "MINT SBT BADGE" to mint real on-chain credentials!');
  console.log('=============================================');
}

main().catch(err => {
  console.error('[Fatal Error] Deploy failed:', err);
});
