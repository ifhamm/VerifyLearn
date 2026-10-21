document.addEventListener('DOMContentLoaded', () => {
  const verifyBtn = document.getElementById('verifyBtn');
  const walletInput = document.getElementById('walletInput');
  const resultsSection = document.getElementById('resultsSection');
  const loadingState = document.getElementById('loadingState');
  
  const userNameDisplay = document.getElementById('userNameDisplay');
  const walletDisplay = document.getElementById('walletDisplay');
  const scoreDisplay = document.getElementById('scoreDisplay');
  const sbtList = document.getElementById('sbtList');

  const getModuleName = (moduleId) => {
    if (moduleId === 'final') return 'Master Certificate';
    if (moduleId === 'module_1') return 'Module 1';
    if (moduleId === 'module_2') return 'Module 2';
    if (moduleId === 'module_3') return 'Module 3';
    if (moduleId === 'module_4') return 'Module 4';
    return moduleId;
  };

  const verifyWallet = async () => {
    const address = walletInput.value.trim();
    
    if (!address) {
      Swal.fire({
        title: 'Error',
        text: 'Please enter a wallet address.',
        icon: 'error',
        confirmButtonColor: '#09090b'
      });
      return;
    }

    // UI States
    resultsSection.classList.add('hidden');
    loadingState.classList.remove('hidden');

    try {
      const response = await fetch(`/api/v1/sbt/verify/${address}`);
      const data = await response.json();

      loadingState.classList.add('hidden');

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to verify wallet.');
      }

      // Populate Data
      userNameDisplay.textContent = data.user.username;
      walletDisplay.textContent = data.user.walletAddress;
      scoreDisplay.textContent = data.user.integrityScore;

      // Populate SBTs
      sbtList.innerHTML = '';
      if (data.sbts.length === 0) {
        sbtList.innerHTML = `
          <div class="col-span-full bg-white border-2 border-textMain p-6 text-center text-textMuted font-bold">
            No Soulbound Tokens (SBTs) found for this address.
          </div>
        `;
      } else {
        data.sbts.forEach(sbt => {
          const isFinal = sbt.module_id === 'final';
          const bgClass = isFinal ? 'bg-brandOrange' : 'bg-white';
          const textClass = isFinal ? 'text-white' : 'text-textMain';
          const title = getModuleName(sbt.module_id);
          const dateStr = new Date(sbt.minted_at).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
          });

          // Honest provenance badge: reflect what the server ACTUALLY verified,
          // never implying on-chain status that was not checked.
          let chainBadge, chainBadgeClass;
          if (sbt.simulated) {
            chainBadge = 'SIMULATED (DEV)';
            chainBadgeClass = 'bg-red-600 text-white';
          } else if (sbt.onChain && sbt.onChain.checked && sbt.onChain.valid) {
            chainBadge = 'ON-CHAIN ✓';
            chainBadgeClass = 'bg-green-600 text-white';
          } else if (sbt.onChain && sbt.onChain.checked && !sbt.onChain.valid) {
            chainBadge = 'CHAIN MISMATCH ✗';
            chainBadgeClass = 'bg-red-600 text-white';
          } else {
            chainBadge = 'CHAIN UNCHECKED';
            chainBadgeClass = 'bg-gray-500 text-white';
          }

          // Explorer link is only offered when a real on-chain tx is known.
          // A recovered credential (hash lost mid-crash) says so plainly
          // instead of rendering a blank "Tx:" line.
          const explorerUrl = sbt.onChain ? sbt.onChain.explorerUrl : null;
          const hasHash = !!sbt.tx_hash;
          const txRow = (hasHash && explorerUrl)
            ? `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="text-xs font-mono opacity-80 break-all bg-black/10 p-2 border border-current hover:underline block">Tx: ${sbt.tx_hash} ↗</a>`
            : hasHash
              ? `<div class="text-xs font-mono opacity-80 break-all bg-black/10 p-2 border border-current">Tx: ${sbt.tx_hash}${sbt.simulated ? ' (simulated)' : ''}</div>`
              : `<div class="text-xs font-mono opacity-80 break-all bg-black/10 p-2 border border-current">Tx: ${sbt.simulated ? 'not on-chain (simulated)' : 'unavailable (recovered without a hash)'}</div>`;

          // Share link is only offered for real credential records (a share
          // page needs a credential id; pending rows do not have one yet).
          const shareRow = sbt.credential_id
            ? `<a href="/verify/c/${sbt.credential_id}" class="block text-center text-xs font-black uppercase px-3 py-2 border-2 border-current bg-brandOrange text-white hover:bg-brandViolet transition">Share / Verify</a>`
            : '';

          const card = document.createElement('div');
          card.className = `${bgClass} ${textClass} border-2 border-textMain p-5 shadow-brutal flex flex-col`;
          card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
              <div class="font-black uppercase text-lg">${title}</div>
              <div class="text-xs font-bold border border-current px-2 py-1 uppercase bg-base text-textMain">SBT ID: #${sbt.token_id || '???'}</div>
            </div>
            <div class="mb-3">
              <span class="text-[10px] font-black uppercase px-2 py-1 ${chainBadgeClass}">${chainBadge}</span>
            </div>
            <div class="mt-auto space-y-2">
              <div class="text-sm font-bold opacity-90">Minted: ${dateStr}</div>
              ${txRow}
              ${shareRow}
            </div>
          `;
          sbtList.appendChild(card);
        });
      }

      resultsSection.classList.remove('hidden');

    } catch (error) {
      loadingState.classList.add('hidden');
      Swal.fire({
        title: 'Not Found',
        text: error.message,
        icon: 'warning',
        confirmButtonColor: '#09090b',
        customClass: {
          popup: 'border-4 border-textMain rounded-none shadow-brutal',
          confirmButton: 'border-2 border-textMain rounded-none shadow-brutal text-white uppercase font-black px-6 py-2'
        }
      });
    }
  };

  verifyBtn.addEventListener('click', verifyWallet);
  walletInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyWallet();
  });
});
