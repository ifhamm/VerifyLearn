document.addEventListener('DOMContentLoaded', () => {
  const progressContent = document.getElementById('progressContent');
  const sessionToken = localStorage.getItem('sessionToken');

  // Set sidebar integrity score at startup
  updateSidebarScore();

  if (!sessionToken) {
    renderLoginRequired();
    return;
  }

  loadProgressData();

  // --- Render Login Required Card ---
  function renderLoginRequired() {
    progressContent.innerHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-10 max-w-xl mx-auto text-center space-y-6">
        <h2 class="text-3xl font-black uppercase text-textMain">SIGN IN REQUIRED</h2>
        <p class="text-textMuted font-bold">Please connect your Web3 Wallet or sign in with a Simulated Account to access your progress report.</p>
        <button id="progressPageLoginBtn" class="px-8 py-4 bg-brandOrange text-white font-black uppercase border-2 border-textMain shadow-brutal hover:bg-brandViolet transition">
          Sign In Now
        </button>
      </div>
    `;

    document.getElementById('progressPageLoginBtn').addEventListener('click', () => {
      const loginModal = document.getElementById('loginModal');
      if (loginModal) loginModal.classList.remove('hidden');
    });
  }

  // --- Load and Render Progress Data ---
  async function loadProgressData() {
    progressContent.innerHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-8 text-center font-bold text-textMain">
        <span class="animate-spin text-xl mr-2">⏳</span>
        <span>Loading report details from database and local storage...</span>
      </div>
    `;

    try {
      // 1. Load Local Storage Data
      const savedPlanRaw = localStorage.getItem('learningPlan');
      const savedSlugs = localStorage.getItem('completedSlugs');
      const integrityRaw = localStorage.getItem('integrityScore');

      let plan = null;
      let completedSlugs = [];
      let integrityScore = integrityRaw ? parseInt(integrityRaw, 10) : 100;

      if (savedPlanRaw && savedPlanRaw !== 'undefined') {
        try {
          plan = JSON.parse(savedPlanRaw);
        } catch (e) {
          console.error(e);
        }
      }

      if (savedSlugs && savedSlugs !== 'undefined') {
        try {
          completedSlugs = JSON.parse(savedSlugs);
        } catch (e) {
          console.error(e);
        }
      }

      // 2. Fetch Quiz History from Backend
      let quizResults = [];
      try {
        const response = await fetch('/api/v1/quiz/results', {
          headers: {
            'Authorization': 'Bearer ' + sessionToken
          }
        });
        if (response.ok) {
          const body = await response.json();
          quizResults = body.data || [];
        }
      } catch (err) {
        console.error('Error fetching quiz results:', err);
      }

      // 2b. Fetch SBTs from Backend
      let userSBTs = [];
      try {
        const sbtResponse = await fetch('/api/v1/user/sbts', {
          headers: {
            'Authorization': 'Bearer ' + sessionToken
          }
        });
        if (sbtResponse.ok) {
          const sbtBody = await sbtResponse.json();
          userSBTs = sbtBody.data || [];
        }
      } catch (err) {
        console.error('Error fetching user SBTs:', err);
      }

      // 3. Render Dashboard Overview
      renderReport(plan, completedSlugs, integrityScore, quizResults, userSBTs);

    } catch (error) {
      console.error(error);
      progressContent.innerHTML = `
        <div class="bg-red-50 border-4 border-textMain shadow-brutal p-8 text-red-500 font-bold">
          Failed to load progress report: ${error.message}
        </div>
      `;
    }
  }

  // --- Render Report View ---
  function renderReport(plan, completedSlugs, integrityScore, quizResults, userSBTs = []) {
    let pathInfoHTML = '';
    let topicsTimelineHTML = '';
    
    let plans = [];
    const savedPlans = localStorage.getItem('learningPlans');
    if (savedPlans && savedPlans !== 'undefined') {
      try {
        plans = JSON.parse(savedPlans);
      } catch (e) {}
    }

    // Filter and group modules (same logic as dashboard.js)
    const selectedLang = localStorage.getItem('selectedLanguage');
    const languageSlugs = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];
    
    let filteredMaterials = [];
    if (plan && plan.materials) {
      filteredMaterials = plan.materials.filter(m => {
        if (m.status === 'dilewati') return false;
        if (selectedLang && languageSlugs.includes(m.slug) && m.slug !== selectedLang) {
          return false;
        }
        return true;
      });
    }

    let modules = [];
    if (filteredMaterials.length > 0) {
      const chunkSize = Math.ceil(filteredMaterials.length / 4);
      modules = [
        { id: 1, title: 'Module I: Fundamentals & Introduction', shortTitle: 'Module I', items: filteredMaterials.slice(0, chunkSize) },
        { id: 2, title: 'Module II: Core Concepts', shortTitle: 'Module II', items: filteredMaterials.slice(chunkSize, 2 * chunkSize) },
        { id: 3, title: 'Module III: Advanced Exploration', shortTitle: 'Module III', items: filteredMaterials.slice(2 * chunkSize, 3 * chunkSize) },
        { id: 4, title: 'Module IV: Projects & Enrichment', shortTitle: 'Module IV', items: filteredMaterials.slice(3 * chunkSize) }
      ].filter(m => m.items.length > 0);
    }

    // Path Details
    if (plan) {
      const roleLabel = plan.role === 'frontend' ? 'Frontend Developer' : plan.role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';
      const totalTopics = plan.materials ? plan.materials.length : 0;
      const completedTopics = plan.materials ? plan.materials.filter(m => completedSlugs.includes(m.slug)).length : 0;
      const progressPercent = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

      let switcherHtml = '';
      if (plans.length > 1) {
        const optionsHtml = plans.map(p => {
          const label = p.role === 'frontend' ? 'Frontend Developer' : p.role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';
          const selected = p.role === plan.role ? 'selected' : '';
          return `<option value="${p.role}" ${selected}>${label} Path</option>`;
        }).join('');

        switcherHtml = `
          <div class="border-2 border-textMain p-4 bg-gray-50 flex items-center justify-between gap-4 mt-4 shadow-brutal-sm">
            <span class="text-xs font-black uppercase text-textMuted">Active Path:</span>
            <select id="pathSwitcherSelect" class="border-2 border-textMain p-2 bg-white font-bold text-xs focus:outline-none cursor-pointer">
              ${optionsHtml}
            </select>
          </div>
        `;
      }

      pathInfoHTML = `
        <div class="bg-white border-4 border-textMain shadow-brutal p-6 md:p-8 space-y-6">
          <h2 class="text-2xl font-black uppercase text-brandViolet">Learning Path Status</h2>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="border-2 border-textMain p-4 bg-panel shadow-brutal-sm">
              <p class="text-xs uppercase font-black text-textMuted">Active Role</p>
              <p class="text-xl font-black text-textMain mt-1 uppercase">${roleLabel}</p>
            </div>
            <div class="border-2 border-textMain p-4 bg-panel shadow-brutal-sm">
              <p class="text-xs uppercase font-black text-textMuted">Target Level</p>
              <p class="text-xl font-black text-textMain mt-1 uppercase">${plan.level || 'beginner'}</p>
            </div>
            <div class="border-2 border-textMain p-4 bg-panel shadow-brutal-sm">
              <p class="text-xs uppercase font-black text-textMuted">Overall Progress</p>
              <p class="text-xl font-black text-brandOrange mt-1 uppercase">${completedTopics} / ${totalTopics} Topics (${progressPercent}%)</p>
            </div>
          </div>

          ${switcherHtml}

          <div class="w-full bg-panel border-2 border-textMain h-5 rounded-none overflow-hidden">
            <div class="bg-brandOrange h-full" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      `;

      // Timeline grouped by module section
      let curriculumHTML = '';
      modules.forEach(mod => {
        let moduleTimelineItems = '';
        mod.items.forEach(m => {
          const isDone = completedSlugs.includes(m.slug);
          const icon = isDone ? '✓' : '○';
          const colorClass = isDone ? 'text-green-600 border-green-600 bg-green-50' : 'text-textMuted border-textMain bg-white';
          moduleTimelineItems += `
            <div class="flex items-start gap-4">
              <div class="w-8 h-8 rounded-full border-2 font-black flex items-center justify-center shrink-0 ${colorClass} shadow-brutal-sm text-xs">
                ${icon}
              </div>
              <div class="flex-1 border-2 border-textMain p-4 bg-white shadow-brutal-sm">
                <h4 class="font-black text-textMain uppercase text-sm">${m.title}</h4>
                <p class="text-[10px] text-textMuted font-bold mt-1 uppercase tracking-wider">${m.topic_type || 'material'}</p>
              </div>
            </div>
          `;
        });

        // Add module quiz status
        const quizSlug = `quiz-module-${mod.id}`;
        const isQuizDone = completedSlugs.includes(quizSlug);
        const quizIcon = isQuizDone ? '✓' : '○';
        const quizColorClass = isQuizDone ? 'text-green-600 border-green-600 bg-green-50' : 'text-brandViolet border-brandViolet bg-white';
        moduleTimelineItems += `
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full border-2 font-black flex items-center justify-center shrink-0 ${quizColorClass} shadow-brutal-sm text-xs">
              ${quizIcon}
            </div>
            <div class="flex-1 border-2 border-brandViolet p-4 bg-white shadow-brutal-sm">
              <h4 class="font-black text-brandViolet uppercase text-sm">${mod.shortTitle} Evaluation Quiz</h4>
              <p class="text-[10px] text-brandOrange font-bold mt-1 uppercase tracking-wider">module evaluation</p>
            </div>
          </div>
        `;

        curriculumHTML += `
          <div class="border-4 border-textMain bg-panel p-6 shadow-brutal space-y-4">
            <h4 class="text-lg font-black text-textMain uppercase tracking-tight">${mod.title}</h4>
            <div class="space-y-4 relative pl-4 border-l-4 border-brandOrange/30 ml-2">
              ${moduleTimelineItems}
            </div>
          </div>
        `;
      });

      topicsTimelineHTML = `
        <div class="space-y-6">
          <div>
            <h3 class="text-2xl font-black uppercase text-textMain tracking-tight">Curriculum Completion Details</h3>
            <p class="text-textMuted font-bold text-sm mt-1">Track your progress and completion status for each topic and module evaluation quiz.</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            ${curriculumHTML}
          </div>
        </div>
      `;

    } else {
      pathInfoHTML = `
        <div class="bg-white border-4 border-textMain shadow-brutal p-8 text-center">
          <h2 class="text-2xl font-black uppercase mb-2">No Active Learning Path</h2>
          <p class="text-textMuted font-bold mb-4">Please generate a learning path below to start your learning journey.</p>
        </div>
      `;
    }

    // Integrity Status Explanation
    let integrityLabel = 'Excellent';
    let integrityColorClass = 'text-green-600';
    if (integrityScore >= 85) {
      integrityLabel = 'Excellent';
      integrityColorClass = 'text-green-600';
    } else if (integrityScore >= 70) {
      integrityLabel = 'Good';
      integrityColorClass = 'text-brandViolet';
    } else if (integrityScore >= 50) {
      integrityLabel = 'Fair';
      integrityColorClass = 'text-orange-500';
    } else {
      integrityLabel = 'Suspicious';
      integrityColorClass = 'text-red-600';
    }

    const integrityCardHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-6 md:p-8">
        <h2 class="text-2xl font-black uppercase text-brandOrange tracking-tight">Integrity & Honor Record</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <div class="border-2 border-textMain p-6 bg-panel shadow-brutal-sm text-center flex flex-col justify-center">
            <p class="text-xs uppercase font-black text-textMuted">Integrity Score</p>
            <p class="text-5xl font-black text-brandOrange mt-2">${integrityScore} / 100</p>
          </div>
          <div class="border-2 border-textMain p-6 bg-white shadow-brutal-sm text-center flex flex-col justify-center">
            <p class="text-xs uppercase font-black text-textMuted">Current Status</p>
            <p class="text-3xl font-black ${integrityColorClass} mt-2 uppercase tracking-tighter">${integrityLabel}</p>
          </div>
          <div class="border-2 border-textMain p-6 bg-white shadow-brutal-sm text-xs font-bold leading-relaxed text-textMuted">
            <p class="uppercase font-black text-textMain mb-1">How it works:</p>
            An integrity score validates honest learning. Honest quiz & code challenge completion boosts your score (+4). AI-detected copying or verification bypass reduces it (-15). Keep it above 70 to stay in good standing.
          </div>
        </div>
      </div>
    `;

    // Quiz History Table
    let tableRows = '';
    if (quizResults.length > 0) {
      quizResults.forEach(r => {
        const verifiedText = r.keystroke_verified 
          ? '<span class="text-green-600 font-black">VERIFIED ✓</span>' 
          : '<span class="text-red-600 font-black">SUSPICIOUS ✗</span>';
        const dateStr = new Date(r.created_at).toLocaleDateString() + ' ' + new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Clean material slug to be reader friendly
        const nameLabel = r.material_slug.replace('quiz-module-', 'Module ').replace('-', ' ').toUpperCase();

        tableRows += `
          <tr class="border-b-2 border-textMain font-bold">
            <td class="p-3 uppercase font-black text-textMain">${nameLabel}</td>
            <td class="p-3 text-brandOrange font-black">${Math.round(r.score)}%</td>
            <td class="p-3">${r.correct_answers} / ${r.total_questions}</td>
            <td class="p-3">${verifiedText}</td>
            <td class="p-3 text-xs text-textMuted font-bold">${dateStr}</td>
          </tr>
        `;
      });
    } else {
      tableRows = `
        <tr>
          <td colspan="5" class="p-6 text-center text-textMuted font-bold uppercase">No quiz records found in database.</td>
        </tr>
      `;
    }

    const quizHistoryHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-6 md:p-8 overflow-hidden">
        <h2 class="text-2xl font-black uppercase text-textMain tracking-tight">Quiz Attempt History</h2>
        <p class="text-textMuted font-bold text-sm mt-1 mb-6">Complete log of all previous RAG Quiz evaluations.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-2 border-textMain bg-white">
            <thead>
              <tr class="bg-panel border-b-2 border-textMain text-xs font-black uppercase text-textMuted">
                <th class="p-3">Quiz / Topic</th>
                <th class="p-3">Score</th>
                <th class="p-3">Correct</th>
                <th class="p-3">Integrity</th>
                <th class="p-3">Completed At</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Customize Form Card
    const currentGoal = plan ? plan.role : 'backend';
    const currentLevel = plan ? plan.level : 'beginner';

    const customizeFormHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-6 md:p-8 space-y-6">
        <div>
          <h2 class="text-2xl font-black uppercase text-brandOrange tracking-tight">Generate New Learning Path</h2>
          <p class="text-textMuted font-bold text-sm mt-1">Ready for a change? Customize and generate a brand-new AI learning path. Doing so will reset your current progress path.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-black uppercase text-textMuted mb-2">Select Target Path</label>
            <select id="newGoalSelect" class="w-full border-2 border-textMain px-4 py-3 bg-white font-bold text-sm focus:outline-none">
              <option value="frontend" ${currentGoal === 'frontend' ? 'selected' : ''}>Frontend Developer</option>
              <option value="backend" ${currentGoal === 'backend' ? 'selected' : ''}>Backend Developer</option>
              <option value="fullstack" ${currentGoal === 'fullstack' ? 'selected' : ''}>Fullstack Developer</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-black uppercase text-textMuted mb-2">Select Skill Level</label>
            <select id="newLevelSelect" class="w-full border-2 border-textMain px-4 py-3 bg-white font-bold text-sm focus:outline-none">
              <option value="beginner" ${currentLevel === 'beginner' ? 'selected' : ''}>Beginner</option>
              <option value="intermediate" ${currentLevel === 'intermediate' ? 'selected' : ''}>Intermediate</option>
              <option value="advanced" ${currentLevel === 'advanced' ? 'selected' : ''}>Advanced</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-black uppercase text-textMuted mb-2">Hours / Day Commitment</label>
            <input type="number" id="newCommitmentInput" min="1" max="24" value="2" class="w-full border-2 border-textMain px-4 py-3 bg-white font-bold text-sm focus:outline-none" />
          </div>

          <div>
            <label class="block text-xs font-black uppercase text-textMuted mb-2">Target Duration</label>
            <select id="newDurationSelect" class="w-full border-2 border-textMain px-4 py-3 bg-white font-bold text-sm focus:outline-none">
              <option value="1w">1 Week</option>
              <option value="2w">2 Weeks</option>
              <option value="1m" selected>1 Month</option>
              <option value="3m">3 Months</option>
              <option value="6m">6 Months</option>
            </select>
          </div>
        </div>

        <button id="newPathBtn" class="w-full py-4 bg-brandOrange text-white font-black uppercase border-2 border-textMain shadow-brutal hover:bg-brandViolet transition text-center mt-2">
          Generate & Start New Path
        </button>
      </div>
    `;

    let sbtBadgesHTML = '';
    modules.forEach(mod => {
      const materialsDone = mod.items.every(item => completedSlugs.includes(item.slug));
      const quizDone = completedSlugs.includes('quiz-module-' + mod.id);
      const isModuleCompleted = materialsDone && quizDone;
      const sbtMinted = userSBTs.find(s => s.module_id === 'module_' + mod.id);

      let cardClass = '';
      let statusHTML = '';

      if (sbtMinted) {
        // Minted SBT
        cardClass = 'bg-amber-50 border-4 border-amber-500 shadow-brutal-sm';
        statusHTML = `
          <div class="space-y-3">
            <span class="inline-block bg-amber-500 text-white font-black text-xs px-2.5 py-1 uppercase tracking-wide">MINTED ✓</span>
            <p class="text-xs font-bold text-amber-900 mt-2">Token ID: <span class="font-black">#${sbtMinted.token_id}</span></p>
            <p class="text-[10px] font-bold text-amber-900 break-all" title="Click to view/copy transaction hash">Tx: <span class="font-black font-mono cursor-pointer hover:text-brandViolet underline" onclick="copyTxHash('${sbtMinted.tx_hash}')">${sbtMinted.tx_hash.substring(0, 10)}...</span></p>
          </div>
        `;
      } else if (isModuleCompleted) {
        // Completed but not minted
        cardClass = 'bg-white border-4 border-textMain shadow-brutal-sm';
        if (integrityScore >= 70) {
          statusHTML = `
            <div class="space-y-3">
              <span class="inline-block bg-green-500 text-white font-black text-xs px-2.5 py-1 uppercase tracking-wide">COMPLETED</span>
              <button data-module-id="module_${mod.id}" class="mint-sbt-btn w-full mt-2 py-2.5 bg-brandOrange text-white font-black uppercase text-xs border-2 border-textMain shadow-brutal-sm hover:bg-brandViolet transition">
                MINT SBT BADGE
              </button>
            </div>
          `;
        } else {
          statusHTML = `
            <div class="space-y-2 text-red-600 font-bold">
              <span class="inline-block bg-red-600 text-white font-black text-xs px-2.5 py-1 uppercase tracking-wide">LOCKED</span>
              <p class="text-xs uppercase mt-2">Integrity Score is <70 (${integrityScore}). Cannot mint credential.</p>
            </div>
          `;
        }
      } else {
        // Locked / In Progress
        cardClass = 'bg-gray-50 border-4 border-gray-300 opacity-60';
        statusHTML = `
          <div class="space-y-2">
            <span class="inline-block bg-gray-400 text-white font-black text-xs px-2.5 py-1 uppercase tracking-wide">LOCKED</span>
            <p class="text-xs text-textMuted font-bold mt-2">Complete all topics and pass the Module Quiz to unlock.</p>
          </div>
        `;
      }

      sbtBadgesHTML += `
        <div class="${cardClass} p-5 flex flex-col justify-between h-56 transition-all duration-300 hover:-translate-y-1">
          <div>
            <p class="text-xs font-black text-brandViolet uppercase tracking-wider">${mod.shortTitle}</p>
            <h3 class="text-base font-black text-textMain uppercase mt-1 leading-snug">${mod.title.split(': ')[1] || mod.title}</h3>
          </div>
          <div class="mt-4">
            ${statusHTML}
          </div>
        </div>
      `;
    });

    // Final Certificate SBT
    const finalSbtMinted = userSBTs.find(s => s.module_id === 'final');
    const allModulesCompleted = modules.length > 0 && modules.every(mod => {
      return completedSlugs.includes('quiz-module-' + mod.id);
    });

    let finalCertificateHTML = '';
    if (finalSbtMinted) {
      finalCertificateHTML = `
        <div class="bg-amber-100 border-4 border-amber-600 shadow-brutal p-8 text-center space-y-6">
          <div class="max-w-md mx-auto">
            <h3 class="text-3xl font-black text-amber-900 uppercase tracking-tighter">🎓 VERIFYLEARN MASTER</h3>
            <p class="text-xs font-bold text-amber-700 uppercase tracking-wider mt-1">Soulbound Path Completion Certificate</p>
            
            <div class="border-2 border-dashed border-amber-600 p-6 bg-amber-50 mt-6 relative">
              <p class="text-xs font-black uppercase text-amber-600 tracking-widest">ON-CHAIN CREDENTIAL MINTED</p>
              <p class="text-2xl font-black text-amber-950 mt-4 uppercase tracking-tight">${plan ? plan.role.toUpperCase() : 'DEVELOPER'} PATH</p>
              <p class="text-sm font-bold text-amber-800 mt-2">Awarded to Wallet address:</p>
              <p class="text-xs font-bold text-brandViolet break-all font-mono mt-1">${localStorage.getItem('walletAddress') || 'Simulated Account'}</p>
              <div class="mt-6 flex justify-between items-center text-xs font-bold text-amber-900">
                <span>Token ID: <span class="font-black">#${finalSbtMinted.token_id}</span></span>
                <span title="Click to view/copy transaction hash">Tx: <span class="font-black font-mono cursor-pointer hover:text-brandViolet underline" onclick="copyTxHash('${finalSbtMinted.tx_hash}')">${finalSbtMinted.tx_hash.substring(0, 14)}...</span></span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (allModulesCompleted) {
      if (integrityScore >= 70) {
        finalCertificateHTML = `
          <div class="bg-white border-4 border-textMain shadow-brutal p-8 text-center space-y-6">
            <div class="max-w-md mx-auto">
              <h3 class="text-2xl font-black text-textMain uppercase tracking-tight">🎓 CLAIM MASTER PATH CERTIFICATE</h3>
              <p class="text-xs font-bold text-textMuted uppercase mt-1">You have successfully completed all modules with authentic learning status.</p>
              
              <button data-module-id="final" class="mint-sbt-btn w-full mt-6 py-4 bg-brandViolet text-white font-black uppercase border-2 border-textMain shadow-brutal hover:bg-brandOrange transition">
                CLAIM SOULBOUND CERTIFICATE (SBT)
              </button>
            </div>
          </div>
        `;
      } else {
        finalCertificateHTML = `
          <div class="bg-red-50 border-4 border-red-200 shadow-brutal p-8 text-center space-y-4">
            <h3 class="text-2xl font-black text-red-800 uppercase">🎓 CERTIFICATE LOCKED</h3>
            <p class="text-sm font-bold text-red-700">All modules completed, but your overall Integrity Score is below the required 70 threshold (Current: ${integrityScore}).</p>
            <p class="text-xs text-red-600 font-bold uppercase">To verify your skills on-chain, please retry quizzes honestly to build up your integrity score.</p>
          </div>
        `;
      }
    } else {
      finalCertificateHTML = `
        <div class="bg-gray-50 border-4 border-gray-300 opacity-60 p-8 text-center space-y-4">
          <h3 class="text-2xl font-black text-gray-400 uppercase">🎓 VERIFYLEARN MASTER CERTIFICATE</h3>
          <p class="text-xs font-bold text-textMuted uppercase">Locked until all modules are completed. Keep reading and passing quizzes!</p>
        </div>
      `;
    }

    const sbtCredentialsHTML = `
      <div class="bg-white border-4 border-textMain shadow-brutal p-6 md:p-8 space-y-8">
        <div>
          <h2 class="text-2xl font-black uppercase text-brandViolet tracking-tight">On-Chain Credentials & Badges (SBT)</h2>
          <p class="text-textMuted font-bold text-sm mt-1">Verify your skill modules directly on the blockchain as Soulbound Tokens. Non-transferable and permanently bound to your identity.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          ${sbtBadgesHTML || '<div class="col-span-4 text-center text-textMuted font-bold py-6">No modules in path yet.</div>'}
        </div>

        <div class="pt-4 border-t-2 border-dashed border-gray-200">
          ${finalCertificateHTML}
        </div>
      </div>
    `;

    progressContent.innerHTML = `
      ${pathInfoHTML}
      ${integrityCardHTML}
      ${sbtCredentialsHTML}
      ${quizHistoryHTML}
      ${customizeFormHTML}
      ${topicsTimelineHTML}
    `;

    // Bind custom path button
    document.getElementById('newPathBtn').addEventListener('click', handleGenerateNewPath);

    // Bind mint sbt buttons
    document.querySelectorAll('.mint-sbt-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const moduleId = e.target.getAttribute('data-module-id');
        handleMintSBT(moduleId);
      });
    });

    // Bind path switcher
    if (plans.length > 1) {
      const switcherSelect = document.getElementById('pathSwitcherSelect');
      if (switcherSelect) {
        switcherSelect.addEventListener('change', async (e) => {
          const selectedRole = e.target.value;
          const selectedPlan = plans.find(p => p.role === selectedRole);
          if (selectedPlan) {
            localStorage.setItem('learningPlan', JSON.stringify(selectedPlan));
            
            Swal.fire({
              title: 'SWITCHING PATH...',
              text: 'Loading your progress for ' + selectedRole.toUpperCase() + '...',
              allowOutsideClick: false,
              showConfirmButton: false,
              didOpen: () => {
                Swal.showLoading();
              }
            });
            
            try {
              const token = localStorage.getItem('sessionToken');
              const res = await fetch('/api/v1/auth/session', {
                headers: {
                  'Authorization': 'Bearer ' + token
                }
              });
              if (res.ok) {
                const body = await res.json();
                localStorage.setItem('completedSlugs', JSON.stringify(body.completedSlugs || []));
                localStorage.setItem('integrityScore', body.integrityScore || '100');
              }
            } catch (err) {
              console.error('Error switching path session sync:', err);
            }
            
            Swal.close();
            window.location.reload();
          }
        });
      }
    }
  }

  // --- Action: Generate New Learning Path ---
  function handleGenerateNewPath() {
    const goal = document.getElementById('newGoalSelect').value;
    const level = document.getElementById('newLevelSelect').value;
    const commitment = document.getElementById('newCommitmentInput').value;
    const durationKey = document.getElementById('newDurationSelect').value;

    const durationMap = {
      '1w': 1,
      '2w': 2,
      '1m': 4,
      '3m': 12,
      '6m': 24
    };
    const duration = durationMap[durationKey] || 4;

    Swal.fire({
      title: 'GENERATE NEW PATH?',
      text: 'Are you sure you want to generate a new path? This will overwrite your existing learning path and reset progress for this specific role.',
      showCancelButton: true,
      confirmButtonText: 'YES, GENERATE!',
      cancelButtonText: 'CANCEL',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
        title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
        htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
        actions: 'w-full flex gap-4 justify-center',
        confirmButton: 'flex-1 py-3 bg-brandOrange text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all',
        cancelButton: 'flex-1 py-3 bg-brandViolet text-white font-black text-sm md:text-base uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        // Trigger path generation loader
        Swal.fire({
          title: 'GENERATING PATH...',
          text: 'AI is analyzing topics and formatting your custom curriculum... Please wait.',
          allowOutsideClick: false,
          showConfirmButton: false,
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl font-black text-brandViolet uppercase tracking-tighter flex items-center justify-center gap-3',
            htmlContainer: 'text-base text-textMuted font-bold mt-4 mb-8'
          },
          didOpen: () => {
            Swal.showLoading();
          }
        });

        try {
          // 1. Fetch from RAG generator endpoint
          const response = await fetch(`/api/v1/learning-path?role=${goal}&level=${level}&commitment=${commitment}&duration=${duration}`, {
            headers: {
              'Authorization': 'Bearer ' + sessionToken
            }
          });

          if (!response.ok) throw new Error('API failed to generate learning path');

          const body = await response.json();
          const newPlan = body.data;

          // 2. Set Local Storage
          localStorage.setItem('learningPlan', JSON.stringify(newPlan));
          localStorage.setItem('completedSlugs', JSON.stringify([]));
          localStorage.setItem('integrityScore', '100');
          localStorage.removeItem('selectedLanguage');

          let localPlans = [];
          const savedLocalPlans = localStorage.getItem('learningPlans');
          if (savedLocalPlans && savedLocalPlans !== 'undefined') {
            try {
              localPlans = JSON.parse(savedLocalPlans);
            } catch (e) {}
          }
          localPlans = localPlans.filter(p => p.role !== newPlan.role);
          localPlans.push(newPlan);
          localStorage.setItem('learningPlans', JSON.stringify(localPlans));

          // 3. Sync path creation to database
          await fetch('/api/v1/user/sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + sessionToken
            },
            body: JSON.stringify({
              learningPlan: newPlan,
              completedSlugs: [],
              integrityScore: 100,
              resetProgress: true
            })
          });

          Swal.close();

          Swal.fire({
            title: 'PATH GENERATED!',
            text: 'Your new AI personalized learning path is ready!',
            confirmButtonText: 'START LEARNING',
            buttonsStyling: false,
            customClass: {
              popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
              title: 'text-2xl md:text-3xl font-black text-green-600 uppercase tracking-tighter flex items-center justify-center gap-3',
              htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
              actions: 'w-full flex justify-center',
              confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandOrange text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
            }
          }).then(() => {
            window.location.href = 'myPath.html';
          });

        } catch (err) {
          console.error(err);
          Swal.fire({
            title: 'GENERATION FAILED',
            text: 'Error generating new path: ' + err.message,
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
        }
      }
    });
  }

  // --- Action: Mint Soulbound Token (SBT) ---
  async function handleMintSBT(moduleId) {
    const sessionToken = localStorage.getItem('sessionToken');
    if (!sessionToken) return;

    Swal.fire({
      title: 'MINT SOULBOUND TOKEN?',
      text: 'Minting this SBT will store your verified module credentials permanently on-chain. This action cannot be undone.',
      showCancelButton: true,
      confirmButtonText: 'YES, MINT NOW!',
      cancelButtonText: 'CANCEL',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
        title: 'text-2xl md:text-3xl font-black text-textMain uppercase tracking-tighter',
        htmlContainer: 'text-base text-textMuted font-bold mt-4 mb-8',
        actions: 'flex gap-4 w-full justify-end mt-4',
        confirmButton: 'flex-1 py-3 bg-brandOrange text-white font-black uppercase border-2 border-textMain shadow-brutal-sm hover:bg-brandViolet transition cursor-pointer',
        cancelButton: 'flex-1 py-3 bg-white text-textMain font-black uppercase border-2 border-textMain shadow-brutal-sm hover:bg-panel transition cursor-pointer'
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        // Show loading Swal
        Swal.fire({
          title: 'MINTING IN PROGRESS...',
          html: 'Please wait. Sending transaction to blockchain and generating Soulbound Token... ⛓️',
          allowOutsideClick: false,
          showConfirmButton: false,
          didOpen: () => {
            Swal.showLoading();
          },
          buttonsStyling: false,
          customClass: {
            popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
            title: 'text-2xl md:text-3xl font-black text-textMain uppercase tracking-tighter',
            htmlContainer: 'text-base text-textMuted font-bold mt-4 mb-8'
          }
        });

        try {
          const res = await fetch('/api/v1/user/mint-sbt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + sessionToken
            },
            body: JSON.stringify({ moduleId })
          });

          const body = await res.json();
          if (res.ok && body.success) {
            Swal.fire({
              title: 'MINT SUCCESSFUL! ⛓️🎉',
              html: `
                <div class="space-y-6 font-bold text-left text-textMain">
                  <div class="p-6 bg-amber-50 border-4 border-amber-500 rounded-none shadow-brutal-sm text-center">
                    <span class="text-5xl">🎓</span>
                    <h4 class="text-xl font-black text-amber-900 uppercase mt-2">Verified Soulbound Badge Minted</h4>
                    <p class="text-xs text-amber-700 uppercase font-black mt-1">Permanently secured on the Blockchain</p>
                  </div>
                  <div class="p-5 bg-white border-4 border-textMain text-sm space-y-4 font-mono shadow-brutal">
                    <div class="flex justify-between border-b border-gray-200 pb-2">
                      <span class="uppercase font-black text-textMuted">Module ID:</span>
                      <span class="text-brandViolet font-black text-right">${body.data.moduleId.replace('_', ' ').toUpperCase()}</span>
                    </div>
                    <div class="flex justify-between border-b border-gray-200 pb-2">
                      <span class="uppercase font-black text-textMuted">Token ID:</span>
                      <span class="text-brandOrange font-black text-right">#${body.data.tokenId}</span>
                    </div>
                    <div class="border-b border-gray-200 pb-2">
                      <span class="uppercase font-black text-textMuted block mb-1">Recipient Wallet:</span>
                      <span class="text-gray-600 text-xs break-all block bg-gray-50 p-2 border border-gray-200 font-bold">${localStorage.getItem('walletAddress') || 'Simulated Address'}</span>
                    </div>
                    <div>
                      <span class="uppercase font-black text-textMuted block mb-1">Transaction Hash:</span>
                      <span class="text-gray-600 text-xs break-all block bg-gray-50 p-2 border border-gray-200 font-bold">${body.data.txHash}</span>
                    </div>
                  </div>
                </div>
              `,
              confirmButtonText: 'AWESOME!',
              buttonsStyling: false,
              customClass: {
                popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8 max-w-xl w-full',
                title: 'text-3xl font-black text-textMain uppercase tracking-tighter text-center',
                htmlContainer: 'text-base text-textMuted mt-4 mb-4',
                actions: 'w-full flex justify-center mt-6',
                confirmButton: 'w-full py-4 bg-brandViolet text-white font-black uppercase border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all cursor-pointer text-center'
              }
            }).then(() => {
              loadProgressData();
            });
          } else {
            Swal.fire({
              title: 'MINT FAILED ✗',
              text: body.error || 'Failed to mint Soulbound Token.',
              confirmButtonText: 'OK',
              buttonsStyling: false,
              customClass: {
                popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
                title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter',
                confirmButton: 'px-8 py-3 bg-brandViolet text-white font-black uppercase border-2 border-textMain shadow-brutal-sm hover:bg-brandOrange transition'
              }
            });
          }
        } catch (error) {
          console.error(error);
          Swal.fire({
            title: 'CONNECTION ERROR ✗',
            text: 'Failed to connect to backend server.',
            confirmButtonText: 'OK',
            buttonsStyling: false,
            customClass: {
              popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
              title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter',
              confirmButton: 'px-8 py-3 bg-brandViolet text-white font-black uppercase border-2 border-textMain shadow-brutal-sm hover:bg-brandOrange transition'
            }
          });
        }
      }
    });
  }

  // --- Sidebar Update Helper ---
  function updateSidebarScore() {
    const sidebarScore = document.getElementById('sidebarScore');
    const sidebarScoreBar = document.getElementById('sidebarScoreBar');
    const sidebarScoreLabel = document.getElementById('sidebarScoreLabel');

    if (sidebarScore || sidebarScoreBar || sidebarScoreLabel) {
      const scoreVal = localStorage.getItem('integrityScore') || '100';
      if (sidebarScore) sidebarScore.textContent = scoreVal;
      if (sidebarScoreBar) sidebarScoreBar.style.width = `${scoreVal}%`;
      if (sidebarScoreLabel) {
        const s = parseInt(scoreVal, 10);
        let label = 'Excellent';
        if (!isNaN(s)) {
          if (s >= 85) label = 'Excellent';
          else if (s >= 70) label = 'Good';
          else if (s >= 50) label = 'Fair';
          else label = 'Suspicious';
        }
        sidebarScoreLabel.textContent = label;
      }
    }
  }
});

// Global function to view/copy full Transaction Hash
window.copyTxHash = (hash) => {
  navigator.clipboard.writeText(hash).then(() => {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Transaction Hash Copied! 📋',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal-sm rounded-none p-4 font-bold text-sm'
      }
    });
  }).catch(() => {
    // Fallback: show the hash in a beautiful alert modal so they can copy it manually
    Swal.fire({
      title: 'TRANSACTION HASH ⛓️',
      html: `
        <div class="space-y-4 text-left font-bold text-textMain">
          <p class="text-sm text-textMuted">Your full transaction hash is secure on-chain:</p>
          <div class="p-4 bg-gray-50 border-2 border-textMain font-mono text-xs select-all break-all shadow-brutal-sm">
            ${hash}
          </div>
          <p class="text-[10px] text-brandOrange uppercase font-black">TIP: Double-click inside the box to select all</p>
        </div>
      `,
      confirmButtonText: 'CLOSE',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8 max-w-md w-full',
        title: 'text-2xl font-black text-textMain uppercase tracking-tighter text-left',
        confirmButton: 'w-full py-3.5 bg-brandViolet text-white font-black uppercase border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandOrange hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all cursor-pointer text-center'
      }
    });
  });
};
