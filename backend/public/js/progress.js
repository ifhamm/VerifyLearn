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

      // 3. Render Dashboard Overview
      renderReport(plan, completedSlugs, integrityScore, quizResults);

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
  function renderReport(plan, completedSlugs, integrityScore, quizResults) {
    let pathInfoHTML = '';
    let topicsTimelineHTML = '';

    // Path Details
    if (plan) {
      const roleLabel = plan.role === 'frontend' ? 'Frontend Developer' : plan.role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';
      const totalTopics = plan.materials ? plan.materials.length : 0;
      const completedTopics = plan.materials ? plan.materials.filter(m => completedSlugs.includes(m.slug)).length : 0;
      const progressPercent = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

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

          <div class="w-full bg-panel border-2 border-textMain h-5 rounded-none overflow-hidden">
            <div class="bg-brandOrange h-full" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      `;

      // Timeline / Topic Completed List
      let timelineItems = '';
      plan.materials.forEach((m, idx) => {
        const isDone = completedSlugs.includes(m.slug);
        const icon = isDone ? '✓' : '○';
        const colorClass = isDone ? 'text-green-600 border-green-600 bg-green-50' : 'text-textMuted border-textMain bg-white';
        timelineItems += `
          <div class="flex items-start gap-4">
            <div class="w-8 h-8 rounded-full border-2 font-black flex items-center justify-center shrink-0 ${colorClass}">
              ${icon}
            </div>
            <div class="flex-1 border-2 border-textMain p-4 bg-white shadow-brutal-sm">
              <h4 class="font-black text-textMain uppercase">${m.title}</h4>
              <p class="text-xs text-textMuted font-bold mt-1 uppercase tracking-wider">${m.topic_type || 'material'}</p>
            </div>
          </div>
        `;
      });

      topicsTimelineHTML = `
        <div class="space-y-6">
          <h3 class="text-2xl font-black uppercase text-textMain tracking-tight">Curriculum Completion Details</h3>
          <div class="space-y-4 relative pl-4 border-l-4 border-textMain">
            ${timelineItems}
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

    progressContent.innerHTML = `
      ${pathInfoHTML}
      ${integrityCardHTML}
      ${quizHistoryHTML}
      ${customizeFormHTML}
      ${topicsTimelineHTML}
    `;

    // Bind custom path button
    document.getElementById('newPathBtn').addEventListener('click', handleGenerateNewPath);
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
      text: 'Are you sure you want to generate a new path? This will ARCHIVE your current learning path and progress.',
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
