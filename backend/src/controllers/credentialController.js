/**
 * Public credential endpoints — the "Credential Share Pack".
 *
 *   GET /api/v1/credentials/:credentialId         — shareable credential detail
 *   GET /api/v1/credentials/:credentialId/vc      — W3C-style Verifiable Credential JSON
 *   GET /api/v1/credentials/:credentialId/qr.png  — server-side QR of the verify URL
 *
 * These are PUBLIC (no wallet auth): a credential id is an unguessable UUID and
 * the whole point is that a third party can check a shared link. Everything is
 * sourced from the record and clearly labelled with its provenance:
 * simulated records say so, revoked records say so, and the on-chain check is
 * reported honestly (checked/valid/reason) rather than assumed.
 */
const crypto = require('crypto');
const { ethers } = require('ethers');
const QRCode = require('qrcode');
const db = require('../utils/db');
const blockchainService = require('../services/blockchainService');

const MODULE_TITLES = {
  module_1: 'Module 1 — Digital Literacy Foundations',
  module_2: 'Module 2 — Information Evaluation',
  module_3: 'Module 3 — Content Creation Ethics',
  module_4: 'Module 4 — Digital Citizenship',
  final: 'Master Certificate — All Modules',
};

// Modules whose quiz result backs this credential (the 'final' certificate is
// gated on all four). Used to attach the score that earned it.
function quizSlugForModule(moduleId) {
  if (moduleId === 'final') return null; // final = aggregate, no single score
  const match = /^module_(\d+)$/.exec(moduleId || '');
  return match ? `quiz-module-${match[1]}` : null;
}

function shortenAddress(address) {
  if (!address || address.length < 12) return address || null;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function baseUrl(req) {
  const configured = (process.env.BASE_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

// Canonical form of the fields covered by the issuer signature. Stable key
// order so the same credential always produces the same digest.
function canonicalPayload({ credentialId, moduleId, walletAddress, mintedAt, txHash, contractAddress, chainId }) {
  return JSON.stringify({
    id: credentialId,
    moduleId,
    subject: walletAddress ? walletAddress.toLowerCase() : null,
    issuanceDate: mintedAt || null,
    txHash: txHash || null,
    contractAddress: contractAddress || null,
    chainId: chainId || null,
  });
}

async function loadCredential(credentialId) {
  const res = await db.query(
    `SELECT s.id, s.credential_id, s.module_id, s.tx_hash, s.token_id, s.minted_at,
            s.status, s.simulated, s.credential_status, s.revoked_at,
            s.revoked_by_wallet, s.revoke_reason,
            u.username, u.wallet_address, u.integrity_score
     FROM user_sbts s
     JOIN users u ON u.id = s.user_id
     WHERE s.credential_id = $1`,
    [credentialId]
  );
  return res.rows[0] || null;
}

async function loadScore(userId, moduleId) {
  const slug = quizSlugForModule(moduleId);
  if (!slug) return null;
  const res = await db.query(
    `SELECT score, total_questions, correct_answers, created_at
     FROM quiz_results
     WHERE user_id = $1 AND material_slug = $2 AND source = 'server'
       AND integrity_status IS DISTINCT FROM 'high_risk'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, slug]
  );
  return res.rows[0] || null;
}

async function onChainCheck(row) {
  const mode = blockchainService.getMode();
  if (row.status !== 'confirmed') {
    return { checked: false, valid: false, mode, reason: `mint_${row.status}` };
  }
  try {
    return await blockchainService.verifyOnChain({
      walletAddress: row.wallet_address,
      moduleId: row.module_id,
      tokenId: row.token_id,
      txHash: row.tx_hash,
      simulated: row.simulated,
    });
  } catch (e) {
    console.error('Public credential on-chain check failed:', e);
    return { checked: false, valid: false, mode, reason: 'verification_error' };
  }
}

/**
 * GET /credentials/:credentialId — everything the public share page renders.
 * A revoked credential is still returned (with status 'revoked') — hiding it
 * would let a stale link 404 while an old screenshot circulates.
 */
exports.getCredential = async (req, res) => {
  try {
    const { credentialId } = req.params;
    const row = await loadCredential(credentialId);
    if (!row) {
      return res.status(404).json({ error: 'Credential not found.' });
    }
    // Rows that never reached a credential state (failed mints) are not
    // shareable — they never minted anything.
    if (row.status === 'failed') {
      return res.status(404).json({ error: 'Credential not found.' });
    }

    const score = await loadScore(row.id, row.module_id).catch((e) => {
      console.error('Credential score lookup failed:', e);
      return null;
    });
    const onChain = await onChainCheck(row);
    const verifyUrl = `${baseUrl(req)}/verify/c/${row.credential_id}`;

    res.json({
      success: true,
      credential: {
        id: row.credential_id,
        moduleId: row.module_id,
        moduleTitle: MODULE_TITLES[row.module_id] || row.module_id,
        status: row.credential_status || 'active',
        mintStatus: row.status,
        simulated: row.simulated === true,
        issuedAt: row.minted_at,
        score: score
          ? { score: score.score, total: score.total_questions, correct: score.correct_answers, recordedAt: score.created_at }
          : null,
        revocation: (row.credential_status === 'revoked')
          ? { revokedAt: row.revoked_at, reason: row.revoke_reason || null }
          : null,
      },
      holder: {
        username: row.username,
        walletAddress: row.wallet_address,
        walletShort: shortenAddress(row.wallet_address),
        integrityScore: row.integrity_score,
      },
      blockchain: {
        mode: blockchainService.getMode(),
        txHash: row.tx_hash || null,
        tokenId: row.token_id,
        contractAddress: process.env.SBT_CONTRACT_ADDRESS || null,
        onChain,
      },
      verifyUrl,
      qrUrl: `${verifyUrl}/qr.png`,
    });
  } catch (error) {
    console.error('Error fetching public credential:', error);
    res.status(500).json({ error: 'Failed to load credential.' });
  }
};

/**
 * GET /credentials/:credentialId/vc — a W3C-style Verifiable Credential.
 *
 * Is NOT a full W3C VC (no DID resolution, no JSON-LD context validation) and
 * does not pretend to be one: the issuer proof is an EIP-191 signature over a
 * canonical SHA-256 digest, verifiable with the issuer address, and the
 * simulated/on-chain provenance is stated explicitly so a consumer cannot
 * mistake a development record for a real on-chain credential.
 */
exports.getCredentialVC = async (req, res) => {
  try {
    const { credentialId } = req.params;
    const row = await loadCredential(credentialId);
    if (!row || row.status === 'failed') {
      return res.status(404).json({ error: 'Credential not found.' });
    }

    const credentialIdFull = row.credential_id;
    const verifyUrl = `${baseUrl(req)}/verify/c/${credentialIdFull}`;
    const onChain = await onChainCheck(row);
    const score = await loadScore(row.id, row.module_id).catch(() => null);

    const proof = await buildProof(row, credentialIdFull, onChain);

    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: `urn:uuid:${credentialIdFull}`,
      type: ['VerifiableCredential', 'VerifyLearnCredential'],
      issuer: {
        id: process.env.SBT_CONTRACT_ADDRESS
          ? `urn:ethereum:${process.env.SBT_CONTRACT_ADDRESS}`
          : 'urn:verifylearn:issuer',
        name: 'VerifyLearn',
      },
      issuanceDate: row.minted_at ? new Date(row.minted_at).toISOString() : null,
      credentialSubject: {
        id: row.wallet_address,
        name: row.username,
        achievement: {
          moduleId: row.module_id,
          title: MODULE_TITLES[row.module_id] || row.module_id,
        },
        ...(score ? { result: { score: score.score, total: score.total_questions, correct: score.correct_answers } } : {}),
        integrityScore: row.integrity_score,
      },
      credentialStatus: {
        id: `${verifyUrl}#status`,
        type: 'VerifyLearnCredentialStatus',
        status: row.credential_status || 'active',
      },
      // Explicit provenance — a simulated or revoked credential must never be
      // presented as an ordinary valid one.
      provenance: {
        simulated: row.simulated === true,
        onChainChecked: onChain.checked === true,
        onChainValid: onChain.valid === true,
        onChainReason: onChain.reason || null,
        txHash: row.tx_hash || null,
        tokenId: row.token_id === undefined ? null : row.token_id,
        contractAddress: process.env.SBT_CONTRACT_ADDRESS || null,
      },
      proof,
      verificationUrl: verifyUrl,
    };

    res.type('application/ld+json').json(vc);
  } catch (error) {
    console.error('Error building credential VC:', error);
    res.status(500).json({ error: 'Failed to build credential.' });
  }
};

/**
 * Issuer proof. Signed with SYSTEM_PRIVATE_KEY (the issuer's own key) when
 * available. In simulated mode the proof is still produced if a key exists but
 * is always labelled simulated, so no one mistakes it for a live attestation.
 */
async function buildProof(row, credentialIdFull, onChain) {
  const chainId = onChain && onChain.chainId ? onChain.chainId : null;
  const payload = canonicalPayload({
    credentialId: credentialIdFull,
    moduleId: row.module_id,
    walletAddress: row.wallet_address,
    mintedAt: row.minted_at ? new Date(row.minted_at).toISOString() : null,
    txHash: row.tx_hash,
    contractAddress: process.env.SBT_CONTRACT_ADDRESS || null,
    chainId,
  });
  const digest = '0x' + crypto.createHash('sha256').update(payload).digest('hex');

  const base = {
    type: 'Eip191Signature',
    created: new Date().toISOString(),
    proofPurpose: 'assertionMethod',
    canonicalizationHash: digest,
    simulated: row.simulated === true,
  };

  const key = process.env.SYSTEM_PRIVATE_KEY;
  if (!key) {
    return { ...base, proofValue: null, note: 'No issuer key configured — signature unavailable.' };
  }
  try {
    let normalized = key.startsWith('0x') ? key : '0x' + key;
    const wallet = new ethers.Wallet(normalized);
    const proofValue = await wallet.signMessage(ethers.getBytes(digest));
    return {
      ...base,
      verificationMethod: `urn:ethereum:${wallet.address}`,
      proofValue,
    };
  } catch (e) {
    console.error('Credential signing failed:', e.message);
    return { ...base, proofValue: null, note: 'Issuer signing unavailable.' };
  }
}

/**
 * GET /credentials/:credentialId/qr.png — QR of the public verify URL.
 * Server-side so it works without any client JS (and prints cleanly).
 */
exports.getCredentialQR = async (req, res) => {
  try {
    const { credentialId } = req.params;
    const row = await loadCredential(credentialId);
    if (!row || row.status === 'failed') {
      return res.status(404).json({ error: 'Credential not found.' });
    }
    const verifyUrl = `${baseUrl(req)}/verify/c/${row.credential_id}`;
    const buffer = await QRCode.toBuffer(verifyUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });
    res.type('png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    console.error('Error generating credential QR:', error);
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
};
