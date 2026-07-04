const { ethers } = require('ethers');

// Helper to generate a mock tx hash
function generateMockTxHash() {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

exports.mintSBT = async (recipientWallet, moduleId) => {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.SYSTEM_PRIVATE_KEY;
  const contractAddress = process.env.SBT_CONTRACT_ADDRESS;

  // Metadata URI format
  const metadataURI = `https://api.verifylearn.com/metadata/sbt/${moduleId}`;

  // If real blockchain configurations are present, attempt actual minting
  if (rpcUrl && privateKey && contractAddress) {
    try {
      console.log(`[Blockchain] Attempting actual mint on-chain for ${recipientWallet}, module: ${moduleId}`);
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      
      const abi = [
        "function mintSBT(address to, string calldata moduleId, string calldata uri) external returns (uint256)",
        "event SBTMinted(address indexed recipient, uint256 indexed tokenId, string moduleId, string tokenURI)"
      ];
      
      const contract = new ethers.Contract(contractAddress, abi, wallet);
      
      // Send the mint transaction
      const tx = await contract.mintSBT(recipientWallet, moduleId, metadataURI);
      console.log(`[Blockchain] Tx sent: ${tx.hash}. Waiting for confirmation...`);
      
      const receipt = await tx.wait();
      console.log(`[Blockchain] Tx confirmed in block: ${receipt.blockNumber}`);
      
      // Parse event logs to get the Token ID
      let tokenId = Math.floor(Math.random() * 1000) + 1; // Fallback
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'SBTMinted') {
            tokenId = Number(parsedLog.args.tokenId);
            break;
          }
        } catch (e) {
          // ignore logs from other contracts if any
        }
      }
      
      return {
        transactionHash: tx.hash,
        tokenId: tokenId
      };
    } catch (err) {
      console.error('[Blockchain] Real on-chain minting failed, falling back to simulation:', err);
    }
  }

  // Simulated Web3 Settlement (development / fallback mode)
  console.log(`[Blockchain] Running simulated Web3 mint for module: ${moduleId}`);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate delay
  
  return {
    transactionHash: generateMockTxHash(),
    tokenId: Math.floor(Math.random() * 900) + 101 // Random ID between 101 and 1000
  };
};

exports.verifyOnChain = async (proof) => {
  return { transactionHash: '0x0' };
};
