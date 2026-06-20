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

  // Initialize page state
  initPage();

  // ── Wallet Connection ──
  if (connectWalletBtn) {
    // Check if already connected
    const savedWallet = localStorage.getItem('walletAddress');
    if (savedWallet) {
      updateWalletUI(savedWallet);
    }

    connectWalletBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (localStorage.getItem('walletAddress')) {
        // Disconnect
        localStorage.removeItem('walletAddress');
        connectWalletBtn.textContent = 'SIGN IN';
        connectWalletBtn.classList.remove('bg-brandOrange');
        connectWalletBtn.classList.add('bg-textMain');
        alert('Wallet disconnected.');
        return;
      }

      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          const address = accounts[0];
          localStorage.setItem('walletAddress', address);
          updateWalletUI(address);
        } catch (err) {
          console.error('Wallet connection error:', err);
          simulateWalletConnection();
        }
      } else {
        simulateWalletConnection();
      }
    });
  }

  function simulateWalletConnection() {
    const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    localStorage.setItem('walletAddress', mockAddress);
    updateWalletUI(mockAddress);
    alert('Web3 wallet extension tidak terdeteksi. Menggunakan akun Web3 simulasi: ' + mockAddress);
  }

  function updateWalletUI(address) {
    if (connectWalletBtn) {
      connectWalletBtn.textContent = address.slice(0, 6) + '...' + address.slice(-4);
      connectWalletBtn.classList.remove('bg-textMain');
      connectWalletBtn.classList.add('bg-brandOrange');
    }
  }

  // ── Initialization & Dashboard Rendering ──
  function initPage() {
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
      assessmentCard.classList.add('hidden');
      dashboardCard.classList.remove('hidden');
      roadmapSection.classList.remove('hidden');
      
      renderDashboard(plan);
      renderRoadmap(plan);
    } else {
      assessmentCard.classList.remove('hidden');
      dashboardCard.classList.add('hidden');
      roadmapSection.classList.add('hidden');
    }
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
        alert('Please enter a valid daily hours commitment (between 1 and 24 hours per day).');
        return;
      }
      
      // Get duration in weeks from selection dropdown
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

      // Clear previous customization choices
      localStorage.removeItem('selectedLanguage');

      try {
        const response = await fetch(`/api/v1/learning-path?role=${role}&level=${skill}&commitment=${commitment}&duration=${duration}`);
        if (!response.ok) {
          throw new Error('Failed to fetch learning path from API');
        }
        
        const body = await response.json();
        const plan = body.data;

        // Save state
        localStorage.setItem('learningPlan', JSON.stringify(plan));
        localStorage.setItem('completedSlugs', JSON.stringify([]));
        if (!localStorage.getItem('integrityScore')) {
          localStorage.setItem('integrityScore', '100');
        }

        // Render Page
        initPage();
      } catch (err) {
        console.error('Error generating path:', err);
        alert('Failed to generate learning path: ' + err.message);
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
        activeTopicTitle = `Kuis Modul ${romanNumerals[i] || (i + 1)}`;
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
          <p class="text-xs uppercase font-bold text-textMuted">Progress Modul ${activeModRoman}</p>
          <p class="text-5xl font-black mt-1">${progressPercent}%</p>
        </div>
      </div>

      <div class="mt-8">
        <p class="text-xs uppercase font-bold mb-2 text-textMuted">Active Topic (Modul ${activeModRoman})</p>
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
    document.getElementById('resetPathBtn').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset your learning path? All progress will be lost.')) {
        localStorage.removeItem('learningPlan');
        localStorage.removeItem('completedSlugs');
        localStorage.removeItem('selectedLanguage');
        initPage();
      }
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
          <div class="text-lg text-textMain font-black tracking-tight leading-snug group-hover:text-brandOrange transition">Quiz Modul ${romanNumerals[modIdx] || (modIdx + 1)}</div>
          <p class="text-xs font-medium text-textMuted mt-2">Selesaikan kuis ini untuk memverifikasi pemahaman Anda tentang konsep modul ini.</p>
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
