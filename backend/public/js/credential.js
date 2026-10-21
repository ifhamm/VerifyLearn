// Public credential share page. Reads the credential id from the URL path
// (/verify/c/:credentialId) and renders the server-verified detail. No auth:
// the id is the capability, and everything shown is either the record or an
// explicitly-labelled on-chain check.
document.addEventListener('DOMContentLoaded', () => {
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const credentialState = document.getElementById('credentialState');

  const text = (id, value) => { document.getElementById(id).textContent = value; };

  const credentialId = (() => {
    const match = /\/verify\/c\/([^/?#]+)/.exec(window.location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  })();

  const showError = (title, message) => {
    loadingState.classList.add('hidden');
    credentialState.classList.add('hidden');
    text('errorTitle', title);
    text('errorText', message);
    errorState.classList.remove('hidden');
  };

  const formatDate = (iso) => {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const render = (data) => {
    const c = data.credential;
    const blockchain = data.blockchain;

    text('holderName', data.holder.username || 'Unknown Learner');
    text('holderWallet', data.holder.walletAddress || '—');
    text('moduleTitle', c.moduleTitle);
    text('issuedAt', formatDate(c.issuedAt));
    text('integrityScore', data.holder.integrityScore);
    text('credentialId', c.id);
    text('verifyUrlText', data.verifyUrl);
    document.getElementById('qrImage').src = `/api/v1/credentials/${c.id}/qr.png`;
    document.getElementById('vcLink').href = `/api/v1/credentials/${c.id}/vc`;

    // Score (only when the credential was backed by a server-graded quiz)
    if (c.score && typeof c.score.score !== 'undefined') {
      document.getElementById('scoreBox').classList.remove('hidden');
      text('scoreValue', `${c.score.score}/${c.score.total}`);
      text('scoreDetail', `${c.score.correct} correct answers · recorded ${formatDate(c.score.recordedAt)}`);
    }

    // Status badge
    const statusBadge = document.getElementById('statusBadge');
    if (c.status === 'revoked') {
      statusBadge.textContent = 'REVOKED';
      statusBadge.className = 'inline-block text-sm font-black uppercase px-3 py-1 border-2 border-textMain bg-red-600 text-white';
    } else if (c.status === 'active') {
      statusBadge.textContent = 'ACTIVE';
      statusBadge.className = 'inline-block text-sm font-black uppercase px-3 py-1 border-2 border-textMain bg-green-600 text-white';
    } else {
      statusBadge.textContent = String(c.status).toUpperCase();
      statusBadge.className = 'inline-block text-sm font-black uppercase px-3 py-1 border-2 border-textMain bg-gray-200';
    }

    // Revocation banner
    if (c.status === 'revoked') {
      document.getElementById('revokedBanner').classList.remove('hidden');
      text('revokedReason', c.revocation && c.revocation.reason
        ? `Reason: ${c.revocation.reason}`
        : 'The issuer revoked this credential. It is no longer valid.');
    }

    // Simulated banner
    if (c.simulated) {
      document.getElementById('simulatedBanner').classList.remove('hidden');
    }

    // Provenance badge — mirror exactly what was verified on-chain.
    const provenance = document.getElementById('provenanceBadge');
    const onChain = blockchain.onChain || {};
    if (c.simulated) {
      provenance.textContent = 'SIMULATED (DEV)';
      provenance.className = 'inline-block text-xs font-black uppercase px-2 py-1 border-2 border-textMain bg-amber-400 text-textMain';
    } else if (onChain.checked && onChain.valid) {
      provenance.textContent = 'ON-CHAIN ✓';
      provenance.className = 'inline-block text-xs font-black uppercase px-2 py-1 border-2 border-textMain bg-green-600 text-white';
    } else if (onChain.checked && !onChain.valid) {
      provenance.textContent = 'CHAIN MISMATCH ✗';
      provenance.className = 'inline-block text-xs font-black uppercase px-2 py-1 border-2 border-textMain bg-red-600 text-white';
    } else {
      provenance.textContent = 'CHAIN UNCHECKED';
      provenance.className = 'inline-block text-xs font-black uppercase px-2 py-1 border-2 border-textMain bg-gray-500 text-white';
    }

    // Transaction — an honest "not available" for recovered records (a real
    // on-chain credential whose hash was lost in a crash) instead of a blank.
    const txEl = document.getElementById('txHash');
    const tx = blockchain.txHash;
    const explorer = onChain.explorerUrl;
    if (tx && explorer) {
      txEl.innerHTML = '';
      const link = document.createElement('a');
      link.href = explorer;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'hover:underline break-all';
      link.textContent = `${tx} ↗`;
      txEl.appendChild(link);
    } else if (tx) {
      txEl.textContent = `${tx}${c.simulated ? ' (simulated)' : ''}`;
    } else {
      txEl.textContent = c.simulated
        ? 'Not on-chain (simulated record).'
        : 'Unavailable — credential recovered from the contract without a recorded transaction hash.';
    }

    // Contract
    text('contractAddress', blockchain.contractAddress || 'Not deployed (simulated mode).');

    loadingState.classList.add('hidden');
    errorState.classList.add('hidden');
    credentialState.classList.remove('hidden');
  };

  const load = async () => {
    if (!credentialId) {
      return showError('Invalid Link', 'This URL does not contain a credential id.');
    }
    try {
      const response = await fetch(`/api/v1/credentials/${encodeURIComponent(credentialId)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status === 404) {
          return showError('Credential Not Found', 'This link does not point to a known credential. It may have been mistyped.');
        }
        return showError('Could Not Load', data.error || 'The credential could not be loaded right now.');
      }
      render(data);
    } catch (err) {
      showError('Connection Error', 'Could not reach the VerifyLearn server. Please try again.');
    }
  };

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('copyBtn').addEventListener('click', async () => {
    const btn = document.getElementById('copyBtn');
    try {
      await navigator.clipboard.writeText(window.location.href);
      const original = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (err) {
      Swal.fire({
        title: 'Copy failed',
        text: 'Please copy the URL from your browser bar.',
        icon: 'info',
        confirmButtonColor: '#09090b',
      });
    }
  });

  load();
});
