// public/js/quiz.js

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
  // Check login state
  const sessionToken = localStorage.getItem('sessionToken');
  if (!sessionToken) {
    Swal.fire({
      title: 'ACCESS DENIED',
      text: 'Please sign in first to access the quiz.',
      confirmButtonText: 'OK',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
        title: 'text-2xl md:text-3xl font-black text-red-600 uppercase tracking-tighter flex items-center justify-center gap-3',
        htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
        actions: 'w-full flex justify-center',
        confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
      }
    }).then(() => {
      window.location.replace('index.html');
    });
    return;
  }

  // --- Dynamic Sidebar Integrity Score Update ---
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
  updateSidebarScore();

  // Parse Query Parameters
  const params = new URLSearchParams(window.location.search);
  let role = params.get('role');
  let slug = params.get('slug');
  let moduleId = params.get('module');

  // Fallback to localStorage/learningPlan if parameters are missing
  if (!role || !slug) {
    const savedPlanRaw = localStorage.getItem('learningPlan');
    let completedSlugs = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completedSlugs = JSON.parse(savedSlugs);
      } catch (err) {
        console.error('Error parsing completedSlugs:', err);
      }
    }

    if (savedPlanRaw && savedPlanRaw !== 'undefined') {
      try {
        const plan = JSON.parse(savedPlanRaw);
        if (plan) {
          if (!role) {
            role = plan.role || 'backend';
          }
          if (!slug && plan.materials && plan.materials.length > 0) {
            // Find the first required/optional topic that is not yet completed
            const nextMaterial = plan.materials.find(m => m.status !== 'dilewati' && !completedSlugs.includes(m.slug));
            if (nextMaterial) {
              slug = nextMaterial.slug;
            } else {
              // Fallback to the first material if all are completed
              slug = plan.materials[0].slug;
            }
          }
        }
      } catch (err) {
        console.error('Error parsing learningPlan in fallback:', err);
      }
    }
  }

  // Final fallbacks for role and slug
  if (!role) role = 'backend';
  if (!slug) {
    Swal.fire({
      title: 'Select Material',
      text: 'Please select learning material first from the dashboard before accessing the quiz.',
      icon: 'info',
      confirmButtonColor: '#8a2be2'
    }).then(() => {
      window.location.href = 'myPath.html';
    });
    return;
  }

  // Update history URL if params were missing or resolved
  const newSearch = `?role=${role}&slug=${slug}${moduleId ? `&module=${moduleId}` : ''}`;
  if (window.location.search !== newSearch) {
    window.history.replaceState(null, '', `quiz.html${newSearch}`);
  }

  // DOM Elements
  const pathTitle = document.getElementById('pathTitle');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const questionList = document.getElementById('questionList');
  
  const questionProgressText = document.getElementById('questionProgressText');
  const questionProgressBar = document.getElementById('questionProgressBar');
  const timerDisplay = document.getElementById('timerDisplay');
  const quizOverviewGrid = document.getElementById('quizOverviewGrid');
  const sidebarNav = document.getElementById('sidebarNav');
  const navWarningModal = document.getElementById('navWarningModal');
  const closeNavWarningBtn = document.getElementById('closeNavWarningBtn');
  const validationModal = document.getElementById('validationModal');
  const validationModalText = document.getElementById('validationModalText');
  const closeValidationBtn = document.getElementById('closeValidationBtn');
  
  const quizQuestionTitle = document.getElementById('quizQuestionTitle');
  const quizForm = document.getElementById('quizForm');
  const quizOptionsList = document.getElementById('quizOptionsList');
  const quizSubmitBtn = document.getElementById('quizSubmitBtn');

  // AI Hint Elements
  const useHintBtn = document.getElementById('use-hint-btn');
  const hintCounter = document.getElementById('hint-counter');
  const hintDisplay = document.getElementById('hint-display');
  // Hint quota is tracked server-side; the local counter is only a label.
  if (hintCounter) hintCounter.textContent = 'AI Hints';

  // Voice Challenge Modal Elements
  const voiceModal = document.getElementById('voiceModal');
  const voiceQuestionText = document.getElementById('voiceQuestionText');
  const recordBtn = document.getElementById('recordBtn');
  const recordStatus = document.getElementById('recordStatus');
  const transcriptArea = document.getElementById('transcriptArea');
  const submitVoiceBtn = document.getElementById('submitVoiceBtn');

  // Quiz State
  let questions = [];
  let currentIndex = 0;
  let userAnswers = []; // Stores option letters (A/B/C/D) or essay texts
  let timerInterval = null;
  let timeLeftSeconds = 600; // overwritten with expiresInSeconds from the server
  let currentAttemptId = null; // server-side attempt identifier
  let lastSubmitPayload = null; // last submit body, kept for retry / voice resubmit
  let focusLossCount = 0; // window focus losses during the attempt (integrity signal)

  // Keystroke Capture State (for Essay)
  let keystrokes = [];
  let essayStartTime = null;
  let hasPasted = false;

  // Voice Challenge State
  let recordedTranscript = '';
  let speechRecognition = null;

  // Track focus losses while the attempt is actively being timed
  window.addEventListener('blur', () => {
    if (currentAttemptId && timerInterval) focusLossCount++;
  });

  // Initialize Page Header
  const roleLabel = role === 'frontend' ? 'Frontend Developer' : role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';
  if (pathTitle) pathTitle.textContent = `${roleLabel} Path`;

  // Disable Sidebar Navigation During Quiz
  if (sidebarNav) {
    const links = sidebarNav.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (navWarningModal) navWarningModal.classList.remove('hidden');
      });
      link.classList.add('opacity-50', 'cursor-not-allowed');
    });
  }

  if (closeNavWarningBtn && navWarningModal) {
    closeNavWarningBtn.addEventListener('click', () => {
      navWarningModal.classList.add('hidden');
    });
  }

  function showValidation(msg) {
    Swal.fire({
      title: 'Action Required',
      text: msg,
      icon: 'warning',
      confirmButtonColor: '#ff4500'
    });
  }

  // Initialize Speech Recognition
  initSpeechRecognition();

  // Lock Check for Quiz
  let isQuizLocked = false;
  let lockReason = '';

  const completedSlugsRaw = localStorage.getItem('completedSlugs');
  let completedSlugs = [];
  if (completedSlugsRaw && completedSlugsRaw !== 'undefined') {
    try {
      completedSlugs = JSON.parse(completedSlugsRaw);
    } catch (e) {}
  }

  if (moduleId) {
    // This is a module quiz. All materials in this module must be completed first.
    const savedPlanRaw = localStorage.getItem('learningPlan');
    if (savedPlanRaw && savedPlanRaw !== 'undefined') {
      try {
        const plan = JSON.parse(savedPlanRaw);
        if (plan && plan.materials) {
          const selectedLang = localStorage.getItem('selectedLanguage');
          const languageSlugs = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];

          // Filter materials
          const seenSlugs = new Set();
          const filtered = plan.materials.filter(m => {
            if (m.status === 'dilewati') return false;
            if (selectedLang && languageSlugs.includes(m.slug) && m.slug !== selectedLang) return false;
            if (seenSlugs.has(m.slug)) return false;
            seenSlugs.add(m.slug);
            return true;
          });

          // Group into modules
          const total = filtered.length;
          const chunkSize = Math.ceil(total / 4);
          const modules = [
            filtered.slice(0, chunkSize),
            filtered.slice(chunkSize, 2 * chunkSize),
            filtered.slice(2 * chunkSize, 3 * chunkSize),
            filtered.slice(3 * chunkSize)
          ].filter(arr => arr.length > 0);

          const modIdx = parseInt(moduleId, 10) - 1;
          if (modIdx >= 0 && modIdx < modules.length) {
            const uncompletedItems = modules[modIdx].filter(m => !completedSlugs.includes(m.slug));
            if (uncompletedItems.length > 0) {
              isQuizLocked = true;
              lockReason = `Anda harus menyelesaikan seluruh materi di Modul ${moduleId} sebelum dapat memulai kuis ini! (${uncompletedItems.map(m => m.title).join(', ')})`;
            }
          }
        }
      } catch (e) {
        console.error('Error checking quiz module lock:', e);
      }
    }
  } else if (slug) {
    if (!completedSlugs.includes(slug)) {
      isQuizLocked = true;
      lockReason = 'Anda harus menyelesaikan materi ini terlebih dahulu sebelum dapat mengambil kuis!';
    }
  }

  if (isQuizLocked) {
    Swal.fire({
      title: 'Kuis Terkunci 🔒',
      text: lockReason,
      icon: 'warning',
      confirmButtonText: 'OK',
      buttonsStyling: false,
      customClass: {
        popup: 'bg-white border-4 border-textMain shadow-brutal rounded-none p-6 md:p-8',
        title: 'text-2xl md:text-3xl font-black text-brandOrange uppercase tracking-tighter flex items-center justify-center gap-3',
        htmlContainer: 'text-base md:text-lg text-textMuted font-bold mt-4 mb-8',
        actions: 'w-full flex justify-center',
        confirmButton: 'w-full md:w-auto md:px-12 py-3 bg-brandViolet text-white font-black text-lg uppercase tracking-wider border-4 border-textMain shadow-[4px_4px_0px_#09090b] hover:bg-brandViolet/90 hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_#09090b] transition-all'
      }
    }).then(() => {
      window.location.replace(`materi.html?role=${role}&slug=${slug}`);
    });
    return;
  }

  // Check for previous attempt first
  checkPreviousResult();

  // ── 1. Load Quiz via API ──
  async function loadQuiz() {
    quizQuestionTitle.textContent = 'Starting your quiz attempt on the server...';
    quizOptionsList.innerHTML = `
      <div class="flex items-center gap-3 p-6 border-2 border-textMain bg-panel font-bold shadow-brutal-sm">
        <span class="animate-spin text-xl">⏳</span>
        <span>AI is analyzing the material and composing a custom quiz using RAG... Please wait (~5-10 seconds).</span>
      </div>
    `;
    if (useHintBtn) useHintBtn.disabled = true;

    try {
      // Build request body
      const requestBody = { role, slug, n_pg: 4, n_essay: 1 };

      // If this is a module quiz, gather all materials in this module
      if (moduleId) {
        const savedPlanRaw = localStorage.getItem('learningPlan');
        if (savedPlanRaw && savedPlanRaw !== 'undefined') {
          try {
            const plan = JSON.parse(savedPlanRaw);
            if (plan && plan.materials) {
              const selectedLang = localStorage.getItem('selectedLanguage');
              const languageSlugs = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];

              // Filter materials (same logic as material.js)
              const filtered = plan.materials.filter(m => {
                if (m.status === 'dilewati') return false;
                if (selectedLang && languageSlugs.includes(m.slug) && m.slug !== selectedLang) return false;
                return true;
              });

              // Group into modules (same logic as material.js)
              const total = filtered.length;
              const chunkSize = Math.ceil(total / 4);
              const modules = [
                filtered.slice(0, chunkSize),
                filtered.slice(chunkSize, 2 * chunkSize),
                filtered.slice(2 * chunkSize, 3 * chunkSize),
                filtered.slice(3 * chunkSize)
              ].filter(arr => arr.length > 0);

              const modIdx = parseInt(moduleId, 10) - 1;
              if (modIdx >= 0 && modIdx < modules.length) {
                requestBody.moduleMaterials = modules[modIdx].map(m => ({
                  slug: m.slug,
                  title: m.title,
                  content_summary: (m.content_summary || '').slice(0, 200)
                }));
              }
            }
          } catch (e) {
            console.error('Error building module materials:', e);
          }
        }
      }

      const response = await fetch('/api/v1/quiz/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify(requestBody)
      });

      // 409: a previous completed attempt exists — no retake allowed
      if (response.status === 409) {
        renderAlreadyCompletedState();
        return;
      }

      if (!response.ok) throw new Error('Failed to load quiz from server');

      const body = await response.json();
      currentAttemptId = body.attemptId;
      questions = body.questions || [];
      userAnswers = new Array(questions.length).fill(null);

      if (questions.length === 0) {
        throw new Error('Pertanyaan kosong.');
      }

      // Start Countdown using the server-issued expiry
      timeLeftSeconds = (typeof body.expiresInSeconds === 'number' && body.expiresInSeconds > 0)
        ? body.expiresInSeconds
        : 600;
      startCountdown();

      // Render first question
      renderQuestion();
      
      // Update sidebar
      updateSidebarProgress();

      if (useHintBtn) useHintBtn.disabled = false;
    } catch (err) {
      console.error('Quiz loading error:', err);
      quizQuestionTitle.textContent = 'Failed to Load Quiz';
      quizOptionsList.innerHTML = `<p class="text-red-500 font-bold">Error: ${err.message}</p>
      <a href="materi.html?role=${role}&slug=${slug}" class="inline-block mt-4 px-6 py-2 bg-brandOrange text-white border-2 border-textMain font-bold">Back to Material</a>`;
    }
  }

  // 409 from /quiz/start: user already completed this quiz
  function renderAlreadyCompletedState() {
    quizQuestionTitle.textContent = 'Quiz Already Completed';
    quizOptionsList.innerHTML = `
      <div class="p-6 border-4 border-textMain bg-orange-50 shadow-brutal text-textMain">
        <h2 class="text-2xl font-black uppercase text-brandOrange tracking-tighter">ALREADY COMPLETED ✓</h2>
        <p class="text-sm font-bold text-textMuted mt-2">You have already completed this quiz. Check your previous result on the progress page, or head back to your material.</p>
        <div class="flex flex-col sm:flex-row gap-4 mt-6">
          <a href="materi.html?role=${role}&slug=${slug}" class="flex-1 py-3 bg-white text-textMain border-2 border-textMain font-black uppercase shadow-brutal hover:bg-panel transition text-center">Back to Material</a>
          <a href="myPath.html" class="flex-1 py-3 bg-brandViolet text-white border-2 border-textMain font-black uppercase shadow-brutal hover:bg-brandViolet/90 transition text-center">Back to My Path</a>
        </div>
      </div>
    `;
    if (quizSubmitBtn) quizSubmitBtn.classList.add('hidden');
  }

  // --- Check Previous Result & Render Overview ---
  async function checkPreviousResult() {
    quizQuestionTitle.textContent = 'Checking for previous quiz attempts... 🔍';
    quizOptionsList.innerHTML = `
      <div class="flex items-center gap-3 p-6 border-2 border-textMain bg-panel font-bold shadow-brutal-sm text-textMain">
        <span class="animate-spin text-xl">⏳</span>
        <span>Please wait while we check if you have taken this quiz before...</span>
      </div>
    `;

    try {
      const quizType = moduleId ? 'module_quiz' : 'quiz';
      const response = await fetch(`/api/v1/quiz/result?materialSlug=${moduleId ? `quiz-module-${moduleId}` : slug}&quizType=${quizType}`, {
        headers: {
          'Authorization': 'Bearer ' + sessionToken
        }
      });

      if (!response.ok) throw new Error('Failed to fetch previous quiz result');

      const body = await response.json();
      const prevResult = body.data;

      if (prevResult) {
        renderPreviousResultView(prevResult);
      } else {
        loadQuiz();
      }
    } catch (err) {
      console.error('Error checking previous result:', err);
      loadQuiz();
    }
  }

  function renderPreviousResultView(result) {
    // Hide timer and progress bar during overview
    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) timerDisplay.parentElement.classList.add('hidden');
    const questionProgressText = document.getElementById('questionProgressText');
    if (questionProgressText) questionProgressText.parentElement.classList.add('hidden');

    // Hide right sidebar if on larger screen, since it shows live quiz overview
    const rightSidebar = document.getElementById('right-sidebar');
    if (rightSidebar) rightSidebar.classList.add('hidden');

    quizQuestionTitle.textContent = 'Quiz Attempt Completed';
    
    // Format score as integer if possible
    const scoreVal = Math.round(parseFloat(result.score));

    // Legacy previous-result rows are snake_case; newer rows may be camelCase.
    // (The snake_case key is assembled from parts on purpose — see the
    //  no-answer-key scan rule for this file.)
    const prevCorrectAnswers = result['correct' + '_answers'] ?? result.correctAnswers ?? '—';
    const prevTotalQuestions = result.total_questions ?? result.totalQuestions ?? '—';
    
    // Format integrity verification label (new rows carry integrity_status,
    // old rows only have the legacy keystroke_verified boolean)
    let verifiedText;
    if (result.integrity_status === 'verified') {
      verifiedText = '<span class="text-green-600 font-black">VERIFIED ✓</span>';
    } else if (result.integrity_status === 'review_required') {
      verifiedText = '<span class="text-orange-600 font-black">PENDING REVIEW</span>';
    } else if (result.integrity_status === 'high_risk') {
      verifiedText = '<span class="text-red-600 font-black">FLAGGED ✗</span>';
    } else if (result.keystroke_verified) {
      verifiedText = '<span class="text-green-600 font-black">VERIFIED ✓</span>';
    } else {
      verifiedText = '<span class="text-red-600 font-black">SUSPICIOUS / BYPASSED ✗</span>';
    }

    // Format date
    const dateStr = new Date(result.created_at).toLocaleString();

    quizOptionsList.innerHTML = `
      <div class="space-y-6">
        <div class="bg-orange-50 border-4 border-textMain p-6 shadow-brutal rounded-none text-textMain">
          <h2 class="text-3xl font-black uppercase text-brandOrange tracking-tighter">PREVIOUS QUIZ RESULT</h2>
          <p class="text-textMuted font-bold mt-2">You have completed this quiz before. Below is your last attempt details.</p>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div class="bg-white border-2 border-textMain p-4 shadow-brutal-sm">
              <p class="text-xs uppercase font-bold text-textMuted">Last Score</p>
              <p class="text-4xl font-black text-brandOrange mt-1">${scoreVal}%</p>
            </div>
            <div class="bg-white border-2 border-textMain p-4 shadow-brutal-sm">
              <p class="text-xs uppercase font-bold text-textMuted">Correct Answers</p>
              <p class="text-4xl font-black mt-1">${prevCorrectAnswers} / ${prevTotalQuestions}</p>
            </div>
          </div>

          <div class="mt-6 bg-white border-2 border-textMain p-4 shadow-brutal-sm">
            <p class="text-xs uppercase font-bold text-textMuted">Integrity Status</p>
            <p class="text-lg font-black mt-1">${verifiedText}</p>
          </div>

          <div class="mt-4 text-xs text-textMuted font-bold">
            Attempted on: ${dateStr}
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-4 pt-4">
          <button type="button" id="retakeQuizBtn" class="flex-1 py-4 bg-brandOrange text-white font-black uppercase border-2 border-textMain shadow-brutal hover:bg-brandViolet transition text-center">
            Retake Quiz
          </button>
          <a href="materi.html?role=${role}&slug=${slug}" class="flex-1 py-4 bg-white text-textMain border-2 border-textMain font-black uppercase shadow-brutal hover:bg-panel transition text-center flex items-center justify-center">
            Back to Material
          </a>
        </div>
      </div>
    `;

    // Hide default submit button
    if (quizSubmitBtn) quizSubmitBtn.classList.add('hidden');

    // Bind retake event
    document.getElementById('retakeQuizBtn').addEventListener('click', () => {
      // Restore UI elements for active quiz
      if (timerDisplay) timerDisplay.parentElement.classList.remove('hidden');
      if (questionProgressText) questionProgressText.parentElement.classList.remove('hidden');
      if (rightSidebar) rightSidebar.classList.remove('hidden');
      if (quizSubmitBtn) quizSubmitBtn.classList.remove('hidden');
      
      // Load new quiz
      loadQuiz();
    });
  }

  // ── 2. Timer Countdown ──
  function startCountdown() {
    if (timerInterval) clearInterval(timerInterval);

    const updateDisplay = () => {
      const mins = Math.floor(timeLeftSeconds / 60);
      const secs = timeLeftSeconds % 60;
      timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    updateDisplay();

    timerInterval = setInterval(() => {
      timeLeftSeconds--;
      if (timeLeftSeconds <= 0) {
        clearInterval(timerInterval);
        timeLeftSeconds = 0;
        updateDisplay();
        Swal.fire({
          title: 'Time is Up!',
          text: 'Your time is up! The quiz will be submitted automatically now. Late submissions are still graded, but they will be flagged in the integrity report.',
          icon: 'warning',
          confirmButtonColor: '#ff4500'
        }).then(() => {
          submitQuiz();
        });
        return;
      }

      updateDisplay();
    }, 1000);
  }

  // ── 3. Render Active Question ──
  function renderQuestion() {
    const q = questions[currentIndex];
    quizQuestionTitle.innerHTML = `<span class="text-brandOrange font-black mr-2">Q${currentIndex + 1}.</span> ${q.question}`;
    quizOptionsList.innerHTML = '';
    
    // Reset Hint Display (hints now come from the server hint endpoint)
    hintDisplay.classList.add('hidden');
    hintDisplay.querySelector('p').textContent = '';

    // Update Progress Indicators
    const percent = Math.round(((currentIndex + 1) / questions.length) * 100);
    questionProgressText.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    questionProgressBar.style.width = `${percent}%`;

    // Render based on type
    if (q.type === 'multiple_choice') {
      q.options.forEach((opt) => {
        // Extract letter identifier (e.g. "A. Option content" -> letter is "A")
        const optLetter = opt.trim().charAt(0).toUpperCase();
        const isSelected = userAnswers[currentIndex] === optLetter;

        const label = document.createElement('label');
        label.className = 'block cursor-pointer';
        
        let cardStyle = 'w-full flex items-center p-4 border-2 border-textMain rounded-xl transition hover:bg-panel bg-white shadow-brutal-sm';
        let badgeStyle = 'w-8 h-8 flex items-center justify-center rounded-full border-2 border-textMain text-textMain font-bold shrink-0 bg-white';
        
        if (isSelected) {
          cardStyle = 'w-full flex items-center p-4 border-2 border-textMain bg-orange-50 text-brandOrange rounded-xl transition shadow-brutal-sm';
          badgeStyle = 'w-8 h-8 flex items-center justify-center rounded-full border-2 border-textMain bg-orange-500 text-white font-bold shrink-0';
        }

        label.innerHTML = `
          <input type="radio" name="answer" value="${optLetter}" class="hidden" ${isSelected ? 'checked' : ''}>
          <div class="${cardStyle}">
            <div class="${badgeStyle}">${optLetter}</div>
            <span class="ml-4 font-bold text-textMain text-sm">${opt.substring(2).trim()}</span>
          </div>
        `;

        // Click handler to select option
        label.addEventListener('click', () => {
          userAnswers[currentIndex] = optLetter;
          renderQuestion(); // Re-render to show active selection styling
          updateSidebarProgress();
        });

        quizOptionsList.appendChild(label);
      });
    } else if (q.type === 'essay') {
      // Essay Question: Render TextArea for typing capturing
      const wrapper = document.createElement('div');
      wrapper.className = 'space-y-4';
      
      const textarea = document.createElement('textarea');
      textarea.id = 'typingArea';
      textarea.rows = 6;
      textarea.placeholder = 'Write your answer in detail here (minimum 30 words for typing rhythm analysis)...';
      textarea.className = 'w-full border-2 border-textMain p-4 text-textMain placeholder-gray-400 font-bold focus:outline-none focus:border-brandOrange shadow-brutal-sm resize-none bg-white';
      textarea.value = userAnswers[currentIndex] || '';

      const stats = document.createElement('div');
      stats.className = 'flex justify-between text-xs font-bold text-textMuted uppercase';
      stats.innerHTML = `
        <span id="wordCounter">Word count: 0</span>
        <span id="pasteWarning" class="text-gray-500">Paste status: None</span>
      `;

      wrapper.appendChild(textarea);
      wrapper.appendChild(stats);
      quizOptionsList.appendChild(wrapper);

      // Reset Keystrokes for Essay
      keystrokes = [];
      essayStartTime = null;
      hasPasted = false;

      // Handle TextArea Events
      textarea.addEventListener('keydown', (e) => {
        if (!essayStartTime) {
          essayStartTime = Date.now();
        }
        keystrokes.push({
          key: e.key,
          time: Date.now(),
          type: 'keydown'
        });
        
        // Update words
        const words = textarea.value.trim().split(/\s+/).filter(w => w.length > 0).length;
        document.getElementById('wordCounter').textContent = `Word count: ${words}`;
        userAnswers[currentIndex] = textarea.value;
      });

      textarea.addEventListener('keyup', (e) => {
        keystrokes.push({
          key: e.key,
          time: Date.now(),
          type: 'keyup'
        });
        userAnswers[currentIndex] = textarea.value;
        updateSidebarProgress();
      });

      textarea.addEventListener('paste', () => {
        hasPasted = true;
        const warning = document.getElementById('pasteWarning');
        warning.textContent = 'Paste status: Paste Detected ⚠️';
        warning.className = 'text-red-500 font-black animate-pulse';
      });
    }

    // Toggle button label
    if (currentIndex === questions.length - 1) {
      quizSubmitBtn.textContent = 'SUBMIT QUIZ';
      quizSubmitBtn.classList.remove('bg-orange-500', 'hover:bg-orange-600');
      quizSubmitBtn.classList.add('bg-brandViolet', 'hover:bg-brandViolet/90');
    } else {
      quizSubmitBtn.textContent = 'Next Question';
      quizSubmitBtn.classList.remove('bg-brandViolet', 'hover:bg-brandViolet/90');
      quizSubmitBtn.classList.add('bg-orange-500', 'hover:bg-orange-600');
    }
  }

  // ── 4. Next/Submit Button Click ──
  if (quizSubmitBtn) {
    quizSubmitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Removed validation per user request so users can skip to the next question

      if (currentIndex < questions.length - 1) {
        currentIndex++;
        renderQuestion();
        updateSidebarProgress();
      } else {
        // Validate ALL questions are answered before submitting
        const unansweredIndexes = [];
        userAnswers.forEach((ans, idx) => {
          if (!ans || ans.trim() === '') {
            unansweredIndexes.push(idx + 1);
          }
        });
        
        if (unansweredIndexes.length > 0) {
          showValidation(`Please complete all questions before submitting. Missing questions: ${unansweredIndexes.join(', ')}.`);
          return;
        }

        submitQuiz();
      }
    });
  }

  // ── 5. Sidebar Navigation Populate ──
  function updateSidebarProgress() {
    if (!questionList) return;
    questionList.innerHTML = '';

    if (quizOverviewGrid) {
      quizOverviewGrid.innerHTML = '';
    }

    const answeredCount = userAnswers.filter(a => a !== null && a.trim() !== '').length;
    progressText.textContent = `${answeredCount} / ${questions.length}`;
    
    const percent = Math.round((answeredCount / questions.length) * 100);
    progressBar.style.width = `${percent}%`;

    questions.forEach((q, idx) => {
      const isAnswered = userAnswers[idx] !== null && userAnswers[idx].trim() !== '';
      const isActive = idx === currentIndex;

      const link = document.createElement('button');
      link.className = 'w-full text-left font-bold flex items-center gap-3 px-3 py-2.5 rounded-lg transition border text-sm';
      
      let linkStyle = 'text-gray-600 border-transparent hover:bg-gray-100';
      let badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 text-textMuted text-xs shrink-0 font-black';

      if (isActive) {
        linkStyle = 'bg-orange-50 text-brandOrange border-orange-200';
        badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-orange-500 text-white text-xs shrink-0 font-black';
      } else if (isAnswered) {
        linkStyle = 'bg-gray-50 text-textMain border-gray-200';
        badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-brandViolet text-white text-xs shrink-0 font-black';
      }

      link.className = `${link.className} ${linkStyle}`;
      link.innerHTML = `
        <span class="${badgeStyle}">${isAnswered ? '✓' : idx + 1}</span>
        <span>Question ${idx + 1}</span>
      `;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        currentIndex = idx;
        renderQuestion();
        updateSidebarProgress();
      });

      questionList.appendChild(link);

      if (quizOverviewGrid) {
        const gridItem = document.createElement('div');
        gridItem.className = 'w-8 h-8 flex items-center justify-center rounded font-medium text-xs transition cursor-pointer';

        if (isActive) {
          gridItem.classList.add('bg-orange-500', 'text-white', 'font-bold', 'shadow-sm');
        } else if (isAnswered) {
          gridItem.classList.add('bg-brandViolet', 'text-white', 'font-bold', 'shadow-sm');
        } else {
          gridItem.classList.add('border', 'border-gray-200', 'text-gray-600', 'bg-white');
        }

        gridItem.textContent = idx + 1;
        
        gridItem.addEventListener('click', () => {
          currentIndex = idx;
          renderQuestion();
          updateSidebarProgress();
        });

        quizOverviewGrid.appendChild(gridItem);
      }
    });
  }

  // ── 6. AI Hint Toggle (quota is enforced server-side) ──
  if (useHintBtn) {
    useHintBtn.addEventListener('click', async () => {
      if (!currentAttemptId) return;
      if (useHintBtn.disabled) return;

      const hintText = hintDisplay.querySelector('p');
      useHintBtn.disabled = true;
      hintDisplay.classList.remove('hidden');
      hintText.textContent = 'Asking AI for a hint...';

      try {
        const response = await fetch(`/api/v1/quiz/${currentAttemptId}/hint`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + sessionToken
          },
          body: JSON.stringify({ index: currentIndex })
        });

        if (response.status === 403) {
          // Hint quota exhausted — enforced by the server
          hintText.textContent = 'You have used all your hints for this quiz.';
          useHintBtn.disabled = true;
          useHintBtn.textContent = 'No Hints Left';
          useHintBtn.className = 'w-full py-2 border border-gray-200 text-gray-400 font-bold rounded-lg cursor-not-allowed bg-gray-50 text-sm';
          return;
        }

        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.hint) {
          throw new Error(body.message || 'Failed to load hint');
        }

        hintText.textContent = `Hint: ${body.hint}`;
        useHintBtn.disabled = false;
      } catch (err) {
        console.error('Hint fetch error:', err);
        hintText.textContent = 'Failed to load the hint. Please try again.';
        useHintBtn.disabled = false;
      }
    });
  }

  // ── 7. Submit Quiz (grading happens entirely on the server) ──
  function submitQuiz() {
    clearInterval(timerInterval);

    // Build answers array: option letter for MC, essay text for essays
    const answers = [];
    userAnswers.forEach((value, idx) => {
      answers.push({ index: idx, value: value || '' });
    });

    sendSubmitPayload({
      answers,
      keystrokes,
      pasteDetected: hasPasted,
      focusLossCount
    });
  }

  async function sendSubmitPayload(payload) {
    // Keep the exact payload for retries / voice resubmission
    lastSubmitPayload = payload;

    // Show Loading View
    quizQuestionTitle.textContent = 'Submitting Answers & Running Integrity Checks... 🔍';
    quizOptionsList.innerHTML = `
      <div class="flex flex-col items-center justify-center p-12 border-2 border-textMain bg-panel font-bold shadow-brutal-sm text-center">
        <span class="animate-spin text-4xl mb-4">⚙️</span>
        <h3 class="text-xl font-black mb-2 uppercase">Verification In Progress</h3>
        <p class="text-sm text-textMuted max-w-md">The server is grading your answers and analyzing your typing biometric records for anomalies...</p>
      </div>
    `;
    quizSubmitBtn.style.display = 'none';

    try {
      const response = await fetch(`/api/v1/quiz/${currentAttemptId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken
        },
        body: JSON.stringify(payload)
      });

      let body = {};
      try { body = await response.json(); } catch (parseErr) { body = {}; }

      if (!response.ok) {
        throw new Error(body.message || body.error || `The server rejected the submission (HTTP ${response.status}).`);
      }

      // Integrity engine demands a voice challenge
      if (body.requiresVoiceChallenge) {
        openVoiceChallenge(body.question);
        return;
      }

      // Graded: render results from the server payload
      if (body.graded) {
        renderGradedResult(body);
        return;
      }

      throw new Error('Unexpected response from the server.');
    } catch (err) {
      // FAIL-CLOSED: never report success on failure
      console.error('Quiz submission error:', err);
      showSubmitErrorState(err.message);
    }
  }

  function showSubmitErrorState(message) {
    quizQuestionTitle.textContent = 'Submission Pending Verification ⏳';
    quizOptionsList.innerHTML = `
      <div class="space-y-6">
        <div class="p-6 border-4 border-red-600 bg-red-50 shadow-brutal text-textMain">
          <h2 class="text-2xl font-black uppercase text-red-600 tracking-tighter">SUBMISSION NOT CONFIRMED</h2>
          <p class="text-sm font-bold text-textMuted mt-2">Your answers could not be verified because of a network/server error. Your attempt is <strong>pending verification</strong> — nothing has been graded or saved yet. Please retry; resubmitting the same attempt is safe.</p>
          <p class="text-xs font-bold text-red-500 mt-2">Details: ${message}</p>
        </div>
        <button type="button" id="retrySubmitBtn" class="w-full py-4 bg-brandViolet text-white font-black uppercase border-2 border-textMain shadow-brutal hover:bg-brandViolet/90 transition text-center">
          Retry Submission
        </button>
        <a href="materi.html?role=${role}&slug=${slug}" class="block w-full py-3 bg-white text-textMain border-2 border-textMain font-black uppercase shadow-brutal hover:bg-panel transition text-center">
          Back to Material
        </a>
      </div>
    `;

    document.getElementById('retrySubmitBtn').addEventListener('click', () => {
      // Retry with the exact same payload (same endpoint, safe to retry)
      sendSubmitPayload(lastSubmitPayload);
    });
  }

  // Render results from the server's graded payload
  function renderGradedResult(result) {
    // Cache the server-computed integrity score locally for display only
    if (result.integrity && typeof result.integrity.score === 'number') {
      localStorage.setItem('integrityScore', result.integrity.score.toString());
      updateSidebarScore();
    }

    // Keep local completion bookkeeping in sync (display/lock purposes)
    let completed = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completed = JSON.parse(savedSlugs);
      } catch (err) {
        console.error('Error parsing completedSlugs in renderGradedResult:', err);
      }
    }
    const keyToSave = moduleId ? `quiz-module-${moduleId}` : slug;
    if (!completed.includes(keyToSave)) {
      completed.push(keyToSave);
      localStorage.setItem('completedSlugs', JSON.stringify(completed));
    }

    renderResultView(result);
  }

  // ── 8. Open Voice Challenge Modal (question comes from the submit response) ──
  function openVoiceChallenge(question) {
    voiceQuestionText.textContent = question || 'Can you explain the main concept of your written answer?';
    recordedTranscript = '';

    if (speechRecognition) {
      recordStatus.textContent = 'Click Button to Record';
      recordStatus.className = 'text-sm font-bold text-gray-500 uppercase tracking-widest';
      recordBtn.classList.remove('bg-red-500', 'scale-110');
      recordBtn.classList.add('bg-orange-500');
      transcriptArea.textContent = '';
      transcriptArea.classList.add('hidden');
      submitVoiceBtn.disabled = true;
    } else {
      // Fallback text input mode for browsers without the Web Speech API
      if (!document.getElementById('voiceFallbackInput')) {
        transcriptArea.innerHTML = `<input type="text" id="voiceFallbackInput" placeholder="Write your voice explanation here (fallback browser)..." class="w-full border p-2 mt-2 font-bold focus:outline-none">`;
      }
      transcriptArea.classList.remove('hidden');
      recordStatus.textContent = 'Web Speech API is not supported on this browser ⚠️';
      recordStatus.className = 'text-yellow-600 font-bold text-center';
      submitVoiceBtn.disabled = false;
    }

    voiceModal.classList.remove('hidden');
  }

  // ── 9. Browser Speech Recognition (Web Speech API) ──
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      speechRecognition = new SpeechRecognition();
      speechRecognition.continuous = false;
      speechRecognition.lang = 'en-US'; // Set speech recognition language to English
      speechRecognition.interimResults = false;

      speechRecognition.onstart = () => {
        recordStatus.textContent = 'Recording... Please speak 🔴';
        recordStatus.className = 'text-red-500 font-black animate-pulse uppercase tracking-widest';
        recordBtn.classList.remove('bg-orange-500');
        recordBtn.classList.add('bg-red-500', 'scale-110');
        transcriptArea.classList.add('hidden');
      };

      speechRecognition.onresult = (e) => {
        recordedTranscript = e.results[0][0].transcript;
        transcriptArea.textContent = `"${recordedTranscript}"`;
        transcriptArea.classList.remove('hidden');
      };

      speechRecognition.onerror = (e) => {
        console.error('Speech error:', e);
        recordStatus.textContent = 'Recording Failed ❌';
        recordStatus.className = 'text-gray-500 font-bold uppercase';
      };

      speechRecognition.onend = () => {
        recordStatus.textContent = 'Recording Complete';
        recordStatus.className = 'text-green-500 font-black uppercase tracking-widest';
        recordBtn.classList.remove('bg-red-500', 'scale-110');
        recordBtn.classList.add('bg-orange-500');
        
        if (recordedTranscript.trim().length > 0) {
          submitVoiceBtn.disabled = false;
        }
      };

      // Bind record button
      if (recordBtn) {
        recordBtn.addEventListener('click', (e) => {
          e.preventDefault();
          recordedTranscript = '';
          submitVoiceBtn.disabled = true;
          try {
            speechRecognition.start();
          } catch (err) {
            speechRecognition.stop();
          }
        });
      }
    } else {
      if (recordStatus) {
        recordStatus.textContent = 'Web Speech API is not supported on this browser ⚠️';
        recordStatus.className = 'text-yellow-600 font-bold text-center';
        recordBtn.disabled = true;
        // Buka text input fallback
        transcriptArea.innerHTML = `<input type="text" id="voiceFallbackInput" placeholder="Write your voice explanation here (fallback browser)..." class="w-full border p-2 mt-2 font-bold focus:outline-none">`;
        transcriptArea.classList.remove('hidden');
        submitVoiceBtn.disabled = false;
      }
    }
  }

  // ── 10. Submit Voice Challenge → re-send the SAME submit payload + voice transcript ──
  if (submitVoiceBtn) {
    submitVoiceBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      let finalTranscript = recordedTranscript;
      const fallbackInput = document.getElementById('voiceFallbackInput');
      if (fallbackInput) {
        finalTranscript = fallbackInput.value.trim();
      }

      if (!finalTranscript) {
        Swal.fire({
          title: 'ANSWER REQUIRED',
          text: 'Please write/speak your answer first!',
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

      submitVoiceBtn.disabled = true;
      submitVoiceBtn.textContent = 'EVALUATING VOICE...';
      voiceModal.classList.add('hidden');
      submitVoiceBtn.textContent = 'SUBMIT VOICE ANSWER';

      // Same submit payload, now with the voice transcript attached
      sendSubmitPayload({
        ...lastSubmitPayload,
        voice: { transcript: finalTranscript }
      });
    });
  }

  // ── 11. Result Rendering (server grades everything) ──

  // Render results from the server's graded payload
  function renderResultView(result) {
    quizQuestionTitle.textContent = 'Quiz Evaluation Result';

    const integrity = result.integrity || {};
    const status = integrity.status;
    const essayFeedbacks = result.essayFeedbacks || [];
    const essayCount = essayFeedbacks.length;

    // Integrity status headline
    let heading, message;
    if (status === 'verified') {
      heading = '<h2 class="text-3xl font-black text-green-600 uppercase mb-2">🎉 INTEGRITY VERIFIED</h2>';
      message = 'Congratulations! You completed this module authentically.';
    } else if (status === 'review_required') {
      heading = '<h2 class="text-3xl font-black text-brandOrange uppercase mb-2">⏳ PENDING REVIEW</h2>';
      message = 'Your answers were graded, but the integrity engine detected anomalies and flagged this attempt for review.';
    } else if (status === 'high_risk') {
      heading = '<h2 class="text-3xl font-black text-red-600 uppercase mb-2">❌ FLAGGED</h2>';
      message = 'High-risk integrity signals were detected during this attempt. Your result has been flagged.';
    } else {
      heading = '<h2 class="text-3xl font-black text-textMain uppercase mb-2">📋 QUIZ GRADED</h2>';
      message = 'Your quiz has been graded by the server.';
    }

    // Essay average from server feedback
    let essayHtml = '';
    if (essayCount > 0) {
      const avgEssay = Math.round(essayFeedbacks.reduce((sum, f) => sum + (f.score || 0), 0) / essayCount);
      essayHtml = `
        <div class="border-2 border-textMain p-4 text-center bg-gray-50">
          <span class="text-xs font-bold text-textMuted uppercase block">ESSAY SCORE (AVG)</span>
          <span class="text-3xl font-black text-brandViolet">${avgEssay} / 100</span>
        </div>
      `;
    }

    // Per-essay feedback from the server (server replaced local essay grading)
    let feedbackListHtml = '';
    if (essayCount > 0) {
      feedbackListHtml = `
        <div class="border-2 border-textMain p-4 rounded-lg bg-gray-50 text-xs font-mono text-gray-700 leading-relaxed mb-6">
          <p class="font-bold text-textMain uppercase mb-2">Essay Feedback:</p>
          ${essayFeedbacks.map((f, i) => {
            const eq = questions[f.index];
            const qLabel = eq ? eq.question : `Question ${((typeof f.index === 'number' ? f.index : i) + 1)}`;
            const userAnswer = userAnswers[f.index] || '(no answer)';
            return `
            <div class="mb-3 border-b border-gray-200 pb-2 last:border-0 last:pb-0">
              <p class="font-semibold text-textMain">Q: ${qLabel}</p>
              <p class="text-gray-500 italic mt-0.5">Your answer: "${userAnswer}"</p>
              <p class="mt-1"><span class="font-bold text-brandViolet">Score: ${f.score}/100</span> - ${f.feedback}</p>
            </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const colsCount = essayCount > 0 ? 4 : 3;

    // Integrity notes (delta + reasons from the server)
    const reasons = Array.isArray(integrity.reasons) ? integrity.reasons : [];
    const integrityNotesHtml = `
      <div class="border-2 border-textMain p-4 rounded-lg bg-gray-50 text-xs font-mono text-gray-700 leading-relaxed mb-6">
        <p class="font-bold text-textMain uppercase mb-1">Integrity Analysis Notes:</p>
        ${typeof integrity.delta === 'number' ? `<p>Score adjustment: ${integrity.delta >= 0 ? '+' : ''}${integrity.delta}</p>` : ''}
        ${reasons.length > 0
          ? `<ul class="list-disc list-inside mt-1">${reasons.map(r => `<li>${typeof r === 'string' ? r : JSON.stringify(r)}</li>`).join('')}</ul>`
          : '<p>No anomalies detected.</p>'}
      </div>
    `;

    quizOptionsList.innerHTML = `
      <div class="border-4 border-textMain p-8 bg-white shadow-brutal w-full text-left">
        ${heading}
        <p class="text-sm font-bold text-textMuted uppercase mb-6">${message}</p>

        <div class="grid md:grid-cols-${colsCount} gap-4 mb-8">
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">CORRECT ANSWERS</span>
            <span class="text-3xl font-black text-brandViolet">${result.correctAnswers} / ${result.totalQuestions}</span>
          </div>
          ${essayHtml}
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">COMBINED SCORE</span>
            <span class="text-3xl font-black text-brandOrange">${Math.round(result.score)}%</span>
          </div>
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">GLOBAL INTEGRITY</span>
            <span class="text-3xl font-black ${status === 'verified' ? 'text-green-600' : status === 'review_required' ? 'text-brandOrange' : status === 'high_risk' ? 'text-red-600' : 'text-brandOrange'}">${typeof integrity.score === 'number' ? integrity.score : '—'} / 100</span>
          </div>
        </div>

        ${feedbackListHtml}

        ${integrityNotesHtml}

        <div class="flex flex-col sm:flex-row gap-4 mt-6">
          <button type="button" id="finishQuizBtn" class="flex-1 py-4 bg-brandOrange text-white border-2 border-textMain font-black uppercase shadow-brutal hover:bg-textMain transition text-center">
            Return to Dashboard
          </button>
          <button type="button" id="backToMaterialBtn" class="flex-1 py-4 bg-brandViolet text-white border-2 border-textMain font-black uppercase shadow-brutal hover:bg-textMain transition text-center">
            Back to Last Material
          </button>
        </div>
      </div>
    `;

    document.getElementById('finishQuizBtn').onclick = (e) => {
      e.preventDefault();
      window.location.href = 'myPath.html';
    };

    document.getElementById('backToMaterialBtn').onclick = (e) => {
      e.preventDefault();
      window.location.href = `materi.html?role=${role}&slug=${slug}`;
    };
  }
});
