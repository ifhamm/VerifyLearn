// public/js/dashboard.js

if (typeof window !== 'undefined' && window.location.search.includes('bypassConfirm=true')) {
  window.confirm = () => true;
}

// Clean up any "undefined" or invalid values in localStorage before anything else
['learningPlan', 'completedSlugs', 'integrityScore', 'walletAddress'].forEach(key => {
  try {
    const val = localStorage.getItem(key);
    if (val === 'undefined' || val === 'null' || val === 'NaN') {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.error('Error cleaning localStorage key:', key, e);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  const assessmentCard = document.getElementById('assessmentCard');
  const dashboardCard = document.getElementById('dashboardCard');
  const generatePathBtn = document.getElementById('generatePathBtn');

  const skillSelect = document.getElementById('skillSelect');
  const goalSelect = document.getElementById('goalSelect');
  const commitmentInput = document.getElementById('commitmentInput');

  const roadmapSection = document.getElementById('roadmapSection');
  const roadmapContainer = document.getElementById('roadmapContainer');
  const roadmapTitle = document.getElementById('roadmapTitle');

  // Neo-Brutalist Auth Elements
  const loginModal = document.getElementById('loginModal');
  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const metaMaskLoginBtn = document.getElementById('metaMaskLoginBtn');
  const mockLoginBtn = document.getElementById('mockLoginBtn');
  const mockUsernameInput = document.getElementById('mockUsernameInput');
  const dashboardLoginBtn = document.getElementById('dashboardLoginBtn');
  const loginRequiredCard = document.getElementById('loginRequiredCard');

  // Initialize page state
  initPage();

  // --- Modal Helpers ---
  function showModal() {
    if (loginModal) loginModal.classList.remove('hidden');
  }

  function hideModal() {
    if (loginModal) loginModal.classList.add('hidden');
  }

  if (closeLoginModalBtn) {
    closeLoginModalBtn.addEventListener('click', hideModal);
  }

  if (loginModal) {
    loginModal.addEventListener('click', (e) => {
      if (e.target === loginModal) hideModal();
    });
  }

  if (dashboardLoginBtn) {
    dashboardLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showModal();
    });
  }

  // ── Wallet / Auth Event Listeners ──
  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (localStorage.getItem('sessionToken')) {
        Swal.fire({
          title: 'SIGN OUT?',
          text: 'Are you sure you want to sign out?',
          showCancelButton: true,
          confirmButtonText: 'YES, SIGN OUT!',
          cancelButtonText: 'CANCEL',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex gap-4 justify-center',
            // Tombol konfirmasi warna oranye
            confirmButton: 'flex-1 py-3 bg-brandOrange text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all',
            // Tombol batal warna ungu
            cancelButton: 'flex-1 py-3 bg-brandViolet text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        }).then((result) => {
          if (result.isConfirmed) {
            logout();
          }
        });
        return;
      }
      showModal();
    });
  }

  // Real MetaMask Login
  if (metaMaskLoginBtn) {
    metaMaskLoginBtn.addEventListener('click', async () => {
      if (window.ethereum) {
        try {
          metaMaskLoginBtn.disabled = true;
          metaMaskLoginBtn.textContent = 'CONNECTING...';

          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          const address = accounts[0];

          const timestamp = Date.now();
          const message = `Welcome to VerifyLearn! Please sign this message to verify your wallet ownership. Timestamp: ${timestamp}`;

          const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, address]
          });

          const response = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address, signature, message, isMock: false })
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Login verification failed.');
          }

          localStorage.setItem('sessionToken', data.token);
          localStorage.setItem('walletAddress', data.walletAddress);
          localStorage.setItem('username', data.username);
          if (data.integrityScore !== undefined) {
            localStorage.setItem('integrityScore', data.integrityScore);
          }
          if (data.learningPlan) {
            localStorage.setItem('learningPlan', JSON.stringify(data.learningPlan));
          }
          if (data.completedSlugs) {
            localStorage.setItem('completedSlugs', JSON.stringify(data.completedSlugs));
          }

          hideModal();
          Swal.fire({
            title: 'WELCOME!',
            text: 'Authenticated successfully with Web3 Wallet!',
            confirmButtonText: 'CONTINUE',
            buttonsStyling: false,
            customClass: {
              popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
              title: 'text-2xl md:text-3xl font-black text-green-600 uppercase tracking-tighter flex items-center justify-center gap-3',
              htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
              actions: 'w-full flex justify-center',
              confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandOrange text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
            }
          });
          initPage();

        } catch (err) {
          console.error('MetaMask error in dashboard:', err);
          Swal.fire({
            title: 'AUTH FAILED',
            text: 'Failed to connect wallet: ' + err.message,
            confirmButtonText: 'TRY AGAIN',
            buttonsStyling: false,
            customClass: {
              popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
              title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter flex items-center justify-center gap-3',
              htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
              actions: 'w-full flex justify-center',
              confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
            }
          });
        } finally {
          metaMaskLoginBtn.disabled = false;
          metaMaskLoginBtn.textContent = 'Connect MetaMask';
        }
      } else {
        Swal.fire({
          title: 'NO METAMASK',
          text: 'MetaMask is not detected. Please use the Account Simulation option.',
          confirmButtonText: 'UNDERSTOOD',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });
      }
    });
  }

  // Simulated Login
  if (mockLoginBtn) {
    mockLoginBtn.addEventListener('click', async () => {
      const usernameVal = mockUsernameInput ? mockUsernameInput.value.trim() : '';
      if (!usernameVal) {
        Swal.fire({
          title: 'REQUIRED FIELD',
          text: 'Please enter your simulated username first.',
          confirmButtonText: 'OK',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });
        return;
      }

      try {
        mockLoginBtn.disabled = true;
        mockLoginBtn.textContent = 'MASUK...';

        const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: mockAddress,
            signature: 'mock-signature',
            username: usernameVal,
            isMock: true
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Simulated login failed.');
        }

        localStorage.setItem('sessionToken', data.token);
        localStorage.setItem('walletAddress', data.walletAddress);
        localStorage.setItem('username', data.username);
        if (data.integrityScore !== undefined) {
          localStorage.setItem('integrityScore', data.integrityScore);
        }
        if (data.learningPlan) {
          localStorage.setItem('learningPlan', JSON.stringify(data.learningPlan));
        }
        if (data.completedSlugs) {
          localStorage.setItem('completedSlugs', JSON.stringify(data.completedSlugs));
        }

        hideModal();
        Swal.fire({
          title: 'WELCOME!',
          text: `Welcome, ${data.username}! You are logged in with a Simulated Account.`,
          confirmButtonText: 'CONTINUE',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-green-600 uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandOrange text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });

        initPage();

      } catch (err) {
        console.error('Simulated login error:', err);
        Swal.fire({
          title: 'LOGIN FAILED',
          text: 'Simulated login failed: ' + err.message,
          confirmButtonText: 'TRY AGAIN',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });
      } finally {
        mockLoginBtn.disabled = false;
        mockLoginBtn.textContent = 'Sign In with Simulated Account';
      }
    });
  }

  // Logout Function
  async function logout() {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
      } catch (err) {
        console.error('Logout error:', err);
      }
    }

    localStorage.removeItem('sessionToken');
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('username');
    localStorage.removeItem('learningPlan');
    localStorage.removeItem('completedSlugs');
    localStorage.removeItem('selectedLanguage');

    Swal.fire({
      title: 'SIGNED OUT',
      text: 'You have been signed out successfully.',
      confirmButtonText: 'OK',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
        title: 'text-2xl md:text-3xl font-black text-green-600 uppercase tracking-tighter flex items-center justify-center gap-3',
        htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
        actions: 'w-full flex justify-center',
        confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandOrange text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
      }
    });
    initPage();
  }

  function updateWalletUI(name) {
    if (connectWalletBtn) {
      if (!name) {
        connectWalletBtn.textContent = 'SIGN IN';
        connectWalletBtn.classList.remove('bg-brandOrange', 'text-white');
        connectWalletBtn.classList.add('bg-white', 'text-textMain');
        return;
      }
      const displayVal = name.startsWith('0x') && name.length > 12
        ? `${name.slice(0, 6)}...${name.slice(-4)}`
        : name;

      connectWalletBtn.textContent = displayVal.toUpperCase();
      connectWalletBtn.classList.remove('bg-white', 'text-textMain');
      connectWalletBtn.classList.add('bg-brandOrange', 'text-white');
    }
  }

  // ── Initialization & Dashboard Rendering ──
  function initPage() {
    const sessionToken = localStorage.getItem('sessionToken');

    if (!sessionToken) {
      // Show login required, hide the rest
      if (loginRequiredCard) loginRequiredCard.classList.remove('hidden');
      if (assessmentCard) assessmentCard.classList.add('hidden');
      if (dashboardCard) dashboardCard.classList.add('hidden');
      if (roadmapSection) roadmapSection.classList.add('hidden');

      updateWalletUI('');
      return;
    }

    if (loginRequiredCard) loginRequiredCard.classList.add('hidden');

    const savedPlan = localStorage.getItem('learningPlan');
    let plan = null;

    if (savedPlan && savedPlan !== 'undefined') {
      try {
        plan = JSON.parse(savedPlan);
      } catch (err) {
        console.error('Error parsing learningPlan from localStorage:', err);
        localStorage.removeItem('learningPlan');
      }
    }

    if (plan) {
      if (assessmentCard) assessmentCard.classList.add('hidden');
      if (dashboardCard) dashboardCard.classList.remove('hidden');
      if (roadmapSection) roadmapSection.classList.remove('hidden');

      renderDashboard(plan);
      renderRoadmap(plan);
    } else {
      if (assessmentCard) assessmentCard.classList.remove('hidden');
      if (dashboardCard) dashboardCard.classList.add('hidden');
      if (roadmapSection) roadmapSection.classList.add('hidden');
    }

    const username = localStorage.getItem('username');
    const walletAddress = localStorage.getItem('walletAddress');
    updateWalletUI(username || walletAddress);
  }

  // Generate Learning Path trigger
  if (generatePathBtn) {
    const durationSelect = document.getElementById('durationSelect');
    generatePathBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      const role = goalSelect.value;
      const skill = skillSelect.value;
      const commitmentVal = commitmentInput ? commitmentInput.value.trim() : '2';

      const commitment = parseFloat(commitmentVal);
      if (isNaN(commitment) || commitment <= 0 || commitment > 24) {
        Swal.fire({
          title: 'INVALID COMMITMENT',
          text: 'Please enter a valid daily hours commitment (between 1 and 24 hours per day).',
          confirmButtonText: 'OK',
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });
        return;
      }

      const durationKey = durationSelect ? durationSelect.value : '1m';
      const durationMap = {
        '1w': 1,
        '2w': 2,
        '1m': 4,
        '3m': 12,
        '6m': 24
      };
      const duration = durationMap[durationKey] || 4;

      generatePathBtn.disabled = true;
      generatePathBtn.textContent = 'GENERATING PATH...';

      localStorage.removeItem('selectedLanguage');

      try {
        const token = localStorage.getItem('sessionToken');
        const response = await fetch(`/api/v1/learning-path?role=${role}&level=${skill}&commitment=${commitment}&duration=${duration}`, {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
        if (!response.ok) {
          throw new Error('Failed to fetch learning path from API (Pastikan Anda sudah login)');
        }

        const body = await response.json();
        const plan = body.data;

        localStorage.setItem('learningPlan', JSON.stringify(plan));
        localStorage.setItem('completedSlugs', JSON.stringify([]));
        if (!localStorage.getItem('integrityScore')) {
          localStorage.setItem('integrityScore', '100');
        }

        // Sync generated path to DB
        await fetch('/api/v1/user/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            learningPlan: plan,
            completedSlugs: [],
            integrityScore: 100
          })
        }).catch(err => console.error('Error syncing path to DB:', err));

        initPage();
      } catch (err) {
        console.error('Error generating path:', err);
        Swal.fire({
          title: 'GENERATION FAILED',
          text: 'Failed to generate learning path: ' + err.message,
          confirmButtonText: 'UNDERSTOOD',

          // Mematikan styling bawaan
          buttonsStyling: false,

          // Memasukkan utility classes Tailwind
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            // Teks merah untuk indikasi error
            title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
            actions: 'w-full flex justify-center',

            // Tombol konfirmasi (Warna Ungu)
            confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
          }
        });
      } finally {
        generatePathBtn.disabled = false;
        generatePathBtn.textContent = 'GENERATE LEARNING PATH';
      }
    });
  }

  function getFilteredMaterials(plan) {
    const list = plan.materials || [];
    const selectedLang = localStorage.getItem('selectedLanguage');
    const languageSlugs = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];

    return list.filter(m => {
      // Filter out any material marked as 'dilewati'
      if (m.status === 'dilewati') return false;

      // Filter out other languages if a language is selected
      if (selectedLang && languageSlugs.includes(m.slug) && m.slug !== selectedLang) {
        return false;
      }
      return true;
    });
  }

  function getModuleGrouping(filteredList) {
    if (filteredList.length === 0) return [];
    const total = filteredList.length;
    const chunkSize = Math.ceil(total / 4);

    return [
      { id: 1, title: 'Module I: Fundamentals & Introduction', items: filteredList.slice(0, chunkSize) },
      { id: 2, title: 'Module II: Core Concepts', items: filteredList.slice(chunkSize, 2 * chunkSize) },
      { id: 3, title: 'Module III: Advanced Exploration', items: filteredList.slice(2 * chunkSize, 3 * chunkSize) },
      { id: 4, title: 'Module IV: Projects & Enrichment', items: filteredList.slice(3 * chunkSize) }
    ].filter(m => m.items.length > 0);
  }

  function renderDashboard(plan) {
    let completedSlugs = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completedSlugs = JSON.parse(savedSlugs);
      } catch (e) {
        console.error('Error parsing completedSlugs:', e);
      }
    }
    const integrityRaw = localStorage.getItem('integrityScore');
    const integrityScore = (integrityRaw && integrityRaw !== 'undefined') ? integrityRaw : '100';

    const filteredList = getFilteredMaterials(plan);
    const modules = getModuleGrouping(filteredList);

    // Find active module (first module with uncompleted materials or uncompleted quiz)
    let activeModuleIndex = 0;
    let activeTopicTitle = 'All Completed! 🎉';
    let activeTopicSlug = '';
    let isStudyLink = false;
    let isQuizLink = false;
    let quizModuleId = null;
    let foundActive = false;

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const uncompletedMaterial = mod.items.find(m => !completedSlugs.includes(m.slug));
      if (uncompletedMaterial) {
        activeModuleIndex = i;
        activeTopicTitle = uncompletedMaterial.title;
        activeTopicSlug = uncompletedMaterial.slug;
        isStudyLink = true;
        foundActive = true;
        break;
      }
      // If materials in this module are completed, check if this module's quiz is completed
      const isQuizDone = completedSlugs.includes('quiz-module-' + mod.id);
      if (!isQuizDone && mod.items.length > 0) {
        activeModuleIndex = i;
        const romanNumerals = ['I', 'II', 'III', 'IV'];
        activeTopicTitle = `Module ${romanNumerals[i] || (i + 1)} Quiz`;
        const lastItem = mod.items[mod.items.length - 1];
        activeTopicSlug = lastItem.slug;
        isQuizLink = true;
        quizModuleId = mod.id;
        foundActive = true;
        break;
      }
    }

    if (!foundActive && modules.length > 0) {
      activeModuleIndex = modules.length - 1;
    }

    // Calculate progress for active module
    let progressPercent = 0;
    let activeModRoman = 'I';
    if (modules.length > 0) {
      const activeMod = modules[activeModuleIndex];
      const totalModItems = activeMod.items.length + 1; // materials + 1 module quiz
      const completedModMaterials = activeMod.items.filter(m => completedSlugs.includes(m.slug)).length;
      const isQuizDone = completedSlugs.includes('quiz-module-' + activeMod.id);
      const completedModItems = completedModMaterials + (isQuizDone ? 1 : 0);
      progressPercent = Math.min(100, Math.round((completedModItems / totalModItems) * 100));

      const romanNumerals = ['I', 'II', 'III', 'IV'];
      activeModRoman = romanNumerals[activeModuleIndex] || (activeModuleIndex + 1);
    }

    const roleLabel = plan.role === 'frontend' ? 'Frontend Developer Path' : plan.role === 'backend' ? 'Backend Developer Path' : 'Fullstack Developer Path';

    dashboardCard.innerHTML = `
      <h2 class="text-3xl font-black uppercase">Welcome Back 👋</h2>
      <p class="text-textMuted mt-2 font-bold uppercase tracking-wider text-brandViolet">${roleLabel}</p>

      <div class="grid grid-cols-2 gap-4 mt-8">
        <div class="border-2 border-textMain p-4 bg-white shadow-brutal-sm">
          <p class="text-xs uppercase font-bold text-textMuted">Integrity Score</p>
          <p class="text-5xl font-black text-brandOrange mt-1">${integrityScore}</p>
        </div>

        <div class="border-2 border-textMain p-4 bg-white shadow-brutal-sm">
          <p class="text-xs uppercase font-bold text-textMuted">Module ${activeModRoman} Progress</p>
          <p class="text-5xl font-black mt-1">${progressPercent}%</p>
        </div>
      </div>

      <div class="mt-8">
        <p class="text-xs uppercase font-bold mb-2 text-textMuted">Active Topic (Module ${activeModRoman})</p>
        <div class="border-2 border-textMain p-4 font-black flex justify-between items-center bg-white shadow-brutal-sm">
          <span>${activeTopicTitle}</span>
          ${isStudyLink ? `<a href="materi.html?role=${plan.role}&slug=${activeTopicSlug}" class="px-4 py-1.5 bg-brandOrange text-white text-xs font-black uppercase border border-textMain shadow-brutal-sm hover:bg-brandViolet transition">Study →</a>` : ''}
          ${isQuizLink ? `<a href="quiz.html?role=${plan.role}&module=${quizModuleId}&slug=${activeTopicSlug}" class="px-4 py-1.5 bg-brandViolet text-white text-xs font-black uppercase border border-textMain shadow-brutal-sm hover:bg-brandOrange transition">Quiz →</a>` : ''}
        </div>
      </div>

      <button id="resetPathBtn" class="mt-8 w-full border-2 border-textMain py-3 text-xs font-black uppercase text-red-500 hover:bg-red-50 transition">
        Reset Learning Path
      </button>
    `;

    // Bind reset
    document.getElementById('resetPathBtn').addEventListener('click', async () => {
      Swal.fire({
        title: 'RESET PATH?',
        text: 'Are you sure you want to reset your learning path? All progress will be lost.',
        showCancelButton: true,
        confirmButtonText: 'YES, RESET IT!',
        cancelButtonText: 'CANCEL',

        // Mematikan styling bawaan
        buttonsStyling: false,

        // Memasukkan utility classes Tailwind
        customClass: {
          popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
          // Menggunakan warna merah untuk indikasi peringatan/bahaya
          title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter flex items-center justify-center gap-3',
          htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
          actions: 'w-full flex gap-4 justify-center',

          // Tombol konfirmasi (Oranye/Destruktif)
          confirmButton: 'flex-1 py-3 bg-brandOrange text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all',

          // Tombol batal (Ungu)
          cancelButton: 'flex-1 py-3 bg-brandViolet text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
        }
      }).then(async (result) => {
        if (result.isConfirmed) {
          const token = localStorage.getItem('sessionToken');
          localStorage.removeItem('learningPlan');
          localStorage.removeItem('completedSlugs');
          localStorage.removeItem('selectedLanguage');

          // Sync reset to DB
          await fetch('/api/v1/user/sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ resetProgress: true, integrityScore: 100 })
          }).catch(err => console.error('Error resetting path on DB:', err));

          initPage();
        }
      });
    });
  }

  function renderRoadmap(plan) {
    let completedSlugs = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completedSlugs = JSON.parse(savedSlugs);
      } catch (e) {
        console.error('Error parsing completedSlugs in roadmap:', e);
      }
    }
    const roleLabel = plan.role === 'frontend' ? 'Frontend Developer' : plan.role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';

    roadmapTitle.textContent = `${roleLabel} Roadmap`;
    roadmapContainer.innerHTML = '';

    const filteredList = getFilteredMaterials(plan);
    const modules = getModuleGrouping(filteredList);

    if (modules.length === 0) return;

    const romanNumerals = ['I', 'II', 'III', 'IV'];

    modules.forEach((modObj, modIdx) => {
      const modCard = document.createElement('div');
      modCard.className = 'w-full mb-10 flex flex-col items-center';

      // Module title header
      const modHeader = document.createElement('div');
      modHeader.className = 'bg-brandViolet text-white border-2 border-textMain px-8 py-4 rounded-xl shadow-brutal font-black uppercase tracking-wide text-center min-w-[280px]';
      modHeader.textContent = modObj.title;
      modCard.appendChild(modHeader);

      // Connector line under module header
      const connector = document.createElement('div');
      connector.className = 'w-1 h-8 bg-textMain';
      modCard.appendChild(connector);

      // Materials list grid
      const materialsGrid = document.createElement('div');
      materialsGrid.className = 'grid md:grid-cols-2 gap-4 w-full';

      modObj.items.forEach((m) => {
        const isCompleted = completedSlugs.includes(m.slug);

        const materialCard = document.createElement('a');
        materialCard.href = `materi.html?role=${plan.role}&slug=${m.slug}`;

        let cardStyle = '';
        let checkmarkHtml = '';
        let badgeText = m.status === 'wajib' ? 'Required' : m.status === 'pilihan' ? 'Optional' : 'Skipped';
        let badgeClass = '';
        let priorityClass = '';

        if (isCompleted) {
          cardStyle = 'border-2 border-green-500 p-5 bg-green-50/30 text-green-800 rounded-xl font-bold shadow-[2px_2px_0px_0px_rgba(34,197,94,1)] hover:shadow-brutal hover:bg-green-50/50 transition block relative group';
          checkmarkHtml = '<span class="absolute right-4 top-4 text-green-600 font-extrabold text-xl">✓</span>';
          badgeClass = 'bg-green-500 text-white border-green-600';
          priorityClass = 'text-green-600';
        } else if (m.status === 'wajib') {
          cardStyle = 'border-2 border-brandOrange p-5 bg-white text-textMain rounded-xl font-bold shadow-[3px_3px_0px_0px_rgba(255,69,0,1)] hover:shadow-brutal transition block relative group';
          badgeClass = 'bg-brandOrange text-white border-brandOrange';
          priorityClass = 'text-brandOrange';
        } else { // pilihan / Optional
          cardStyle = 'border-2 border-dashed border-brandViolet/80 p-5 bg-white text-textMuted rounded-xl font-bold shadow-none hover:shadow-brutal-sm hover:border-brandViolet transition block relative group';
          badgeClass = 'bg-brandViolet text-white border-brandViolet';
          priorityClass = 'text-brandViolet';
        }

        materialCard.className = cardStyle;
        materialCard.innerHTML = `
          ${checkmarkHtml}
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 border text-[10px] font-black uppercase rounded ${badgeClass}">${badgeText}</span>
            <span class="text-xs uppercase font-black ${priorityClass} transition">${m.priority} topic</span>
          </div>
          <div class="text-lg text-textMain font-black tracking-tight leading-snug group-hover:text-brandOrange transition">${m.title}</div>
          <p class="text-xs font-medium text-textMuted mt-2 line-clamp-2">${m.content_summary}...</p>
        `;

        materialsGrid.appendChild(materialCard);
      });

      // Add Module Quiz at the end of the module
      if (modObj.items.length > 0) {
        const lastItem = modObj.items[modObj.items.length - 1];
        const isQuizCompleted = completedSlugs.includes('quiz-module-' + modObj.id);
        const quizCard = document.createElement('a');
        quizCard.href = `quiz.html?role=${plan.role}&module=${modObj.id}&slug=${lastItem.slug}`;

        let quizStyle = '';
        let quizCheckmark = '';
        if (isQuizCompleted) {
          quizStyle = 'border-2 border-green-500 p-5 bg-green-50/30 text-green-800 rounded-xl font-bold shadow-[2px_2px_0px_0px_rgba(34,197,94,1)] hover:shadow-brutal hover:bg-green-50/50 transition block relative group col-span-1 md:col-span-2 text-center border-dashed';
          quizCheckmark = '<span class="absolute right-4 top-4 text-green-600 font-extrabold text-xl">✓</span>';
        } else {
          quizStyle = 'border-2 border-brandViolet p-5 bg-white text-textMain rounded-xl font-bold shadow-[3px_3px_0px_0px_rgba(138,43,226,1)] hover:shadow-brutal transition block relative group col-span-1 md:col-span-2 text-center border-dashed';
        }

        quizCard.className = quizStyle;
        quizCard.innerHTML = `
          ${quizCheckmark}
          <div class="flex items-center justify-center gap-2 mb-2">
            <span class="px-2 py-0.5 border text-[10px] font-black uppercase rounded bg-brandViolet text-white border-brandViolet">QUIZ</span>
            <span class="text-xs uppercase font-black text-brandViolet">Module verification</span>
          </div>
          <div class="text-lg text-textMain font-black tracking-tight leading-snug group-hover:text-brandOrange transition">Module ${romanNumerals[modIdx] || (modIdx + 1)} Quiz</div>
          <p class="text-xs font-medium text-textMuted mt-2">Complete this quiz to verify your understanding of this module's concepts.</p>
        `;
        materialsGrid.appendChild(quizCard);
      }

      modCard.appendChild(materialsGrid);

      // Add a connector line to the next module
      if (modIdx < modules.length - 1) {
        const modConnector = document.createElement('div');
        modConnector.className = 'w-1 h-12 bg-textMain mt-4';
        modCard.appendChild(modConnector);
      }

      roadmapContainer.appendChild(modCard);
    });
  }
});
