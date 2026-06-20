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
    alert('Silakan pilih materi belajar terlebih dahulu dari dashboard sebelum mengakses kuis.');
    window.location.href = 'myPath.html';
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
  let timeLeftSeconds = 600; // 10 minutes

  // Keystroke Capture State (for Essay)
  let keystrokes = [];
  let essayStartTime = null;
  let hasPasted = false;

  // Voice Challenge State
  let expectedKeywords = [];
  let recordedTranscript = '';
  let speechRecognition = null;

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
    if (validationModal && validationModalText) {
      validationModalText.textContent = msg;
      validationModal.classList.remove('hidden');
    } else {
      alert(msg);
    }
  }

  if (closeValidationBtn && validationModal) {
    closeValidationBtn.addEventListener('click', () => {
      validationModal.classList.add('hidden');
    });
  }

  // Initialize Speech Recognition
  initSpeechRecognition();

  // Load Questions
  loadQuiz();

  // ── 1. Load Quiz via API ──
  async function loadQuiz() {
    quizQuestionTitle.textContent = 'Meminta AI membuat kuis untuk Anda... 🤖';
    quizOptionsList.innerHTML = `
      <div class="flex items-center gap-3 p-6 border-2 border-textMain bg-panel font-bold shadow-brutal-sm">
        <span class="animate-spin text-xl">⏳</span>
        <span>AI sedang menganalisis materi dan menyusun kuis kustom menggunakan RAG... Harap tunggu (~5-10 detik).</span>
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

      const response = await fetch('/api/v1/generate-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) throw new Error('Gagal memuat kuis dari server');

      const body = await response.json();
      questions = body.data || [];
      userAnswers = new Array(questions.length).fill(null);

      if (questions.length === 0) {
        throw new Error('Pertanyaan kosong.');
      }

      // Start Countdown
      startCountdown();

      // Render first question
      renderQuestion();
      
      // Update sidebar
      updateSidebarProgress();

      if (useHintBtn) useHintBtn.disabled = false;
    } catch (err) {
      console.error('Quiz loading error:', err);
      quizQuestionTitle.textContent = 'Gagal Memuat Kuis';
      quizOptionsList.innerHTML = `<p class="text-red-500 font-bold">Error: ${err.message}</p>
      <a href="materi.html?role=${role}&slug=${slug}" class="inline-block mt-4 px-6 py-2 bg-brandOrange text-white border-2 border-textMain font-bold">Kembali ke Materi</a>`;
    }
  }

  // ── 2. Timer Countdown ──
  function startCountdown() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeLeftSeconds--;
      if (timeLeftSeconds <= 0) {
        clearInterval(timerInterval);
        timeLeftSeconds = 0;
        alert('Waktu habis! Kuis akan dikirim otomatis.');
        submitQuiz();
      }

      const mins = Math.floor(timeLeftSeconds / 60);
      const secs = timeLeftSeconds % 60;
      timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
  }

  // ── 3. Render Active Question ──
  function renderQuestion() {
    const q = questions[currentIndex];
    quizQuestionTitle.innerHTML = `<span class="text-brandOrange font-black mr-2">Q${currentIndex + 1}.</span> ${q.question}`;
    quizOptionsList.innerHTML = '';
    
    // Reset Hint Display
    hintDisplay.classList.add('hidden');
    hintDisplay.querySelector('p').textContent = q.explanation ? `Hint: ${q.explanation}` : 'AI Hint tidak tersedia untuk soal ini.';

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
      textarea.placeholder = 'Tuliskan jawaban Anda secara detail di sini (minimal 30 kata untuk analisis ritme ketikan)...';
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

  // ── 6. AI Hint Toggle ──
  if (useHintBtn) {
    let hintsLeft = 3;
    useHintBtn.addEventListener('click', () => {
      if (hintsLeft > 0) {
        hintsLeft--;
        hintCounter.textContent = `${hintsLeft} Left`;
        hintDisplay.classList.remove('hidden');

        if (hintsLeft === 0) {
          useHintBtn.disabled = true;
          useHintBtn.textContent = 'No Hints Left';
          useHintBtn.className = 'w-full py-2 border border-gray-200 text-gray-400 font-bold rounded-lg cursor-not-allowed bg-gray-50 text-sm';
        }
      }
    });
  }

  // ── 7. Submit Quiz & Integrity Verification ──
  async function submitQuiz() {
    clearInterval(timerInterval);

    // Show Loading View
    quizQuestionTitle.textContent = 'Memverifikasi Jawaban & Menguji Pola Integritas... 🔍';
    quizOptionsList.innerHTML = `
      <div class="flex flex-col items-center justify-center p-12 border-2 border-textMain bg-panel font-bold shadow-brutal-sm text-center">
        <span class="animate-spin text-4xl mb-4">⚙️</span>
        <h3 class="text-xl font-black mb-2 uppercase">Integrity Analysis In Progress</h3>
        <p class="text-sm text-textMuted max-w-md">Mengirimkan rekaman biometrik ketikan Anda ke AI Anomaly Engine untuk dianalisis...</p>
      </div>
    `;
    quizSubmitBtn.style.display = 'none';

    // 1. Hitung Nilai Pilihan Ganda (PG)
    let correctCount = 0;
    let totalPg = 0;
    questions.forEach((q, idx) => {
      if (q.type === 'multiple_choice') {
        totalPg++;
        if (userAnswers[idx] === q.correct_answer) {
          correctCount++;
        }
      }
    });

    // 2. Kirim Pola Ketikan Ke Keystroke Verifier
    try {
      const response = await fetch('/api/v1/verify-keystroke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keystrokes })
      });

      const keyResult = await response.json();
      
      // Jika copy-paste terdeteksi lokal, paksa non-verified
      if (hasPasted) {
        keyResult.verified = false;
        keyResult.message = "Pola anomali: Terdeteksi tindakan Copy-Paste pada isian jawaban.";
      }

      if (keyResult.verified === false) {
        // TRIGGER VOICE CHALLENGE (ANTI-CHEAT)
        triggerVoiceChallenge(keyResult.message);
      } else {
        // Lulus Integritas! Simpan progress kuis berhasil
        saveQuizSuccess(correctCount, totalPg, keyResult);
      }
    } catch (err) {
      console.error('Integrity checks failed:', err);
      // Fallback: anggap lulus jika jaringan gagal demi kelancaran demo
      saveQuizSuccess(correctCount, totalPg, { verified: true, message: 'Verifikasi dilewati karena gangguan jaringan.' });
    }
  }

  // ── 8. Trigger Voice Challenge Modal ──
  async function triggerVoiceChallenge(reason) {
    voiceQuestionText.textContent = 'Membangun pertanyaan suara oleh AI... 🎙️';
    voiceModal.classList.remove('hidden');

    const essayIndex = questions.findIndex(q => q.type === 'essay');
    const userEssayAnswer = userAnswers[essayIndex] || '';

    try {
      const response = await fetch('/api/v1/generate-voice-challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role,
          slug,
          userCodeOrText: userEssayAnswer,
          triggerReason: reason
        })
      });

      if (!response.ok) throw new Error('Gagal membuat pertanyaan suara');

      const body = await response.json();
      const challenge = body.data;

      voiceQuestionText.textContent = challenge.question;
      expectedKeywords = challenge.expected_keywords || [];
    } catch (err) {
      console.error('Voice challenge error:', err);
      voiceQuestionText.textContent = 'Dapatkah Anda menjelaskan konsep utama dari jawaban tertulis Anda?';
      expectedKeywords = ['html', 'css', 'javascript', 'backend', 'web'];
    }
  }

  // ── 9. Browser Speech Recognition (Web Speech API) ──
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      speechRecognition = new SpeechRecognition();
      speechRecognition.continuous = false;
      speechRecognition.lang = 'id-ID'; // Set bahasa Indonesia
      speechRecognition.interimResults = false;

      speechRecognition.onstart = () => {
        recordStatus.textContent = 'Merekam... Silakan Bicara 🔴';
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
        recordStatus.textContent = 'Gagal Merekam ❌';
        recordStatus.className = 'text-gray-500 font-bold uppercase';
      };

      speechRecognition.onend = () => {
        recordStatus.textContent = 'Perekaman Selesai';
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
        recordStatus.textContent = 'Web Speech API tidak didukung pada browser ini ⚠️';
        recordStatus.className = 'text-yellow-600 font-bold text-center';
        recordBtn.disabled = true;
        // Buka text input fallback
        transcriptArea.innerHTML = `<input type="text" id="voiceFallbackInput" placeholder="Tuliskan penjelasan suara Anda di sini (fallback browser)..." class="w-full border p-2 mt-2 font-bold focus:outline-none">`;
        transcriptArea.classList.remove('hidden');
        submitVoiceBtn.disabled = false;
      }
    }
  }

  // ── 10. Submit Voice Verification to Backend ──
  if (submitVoiceBtn) {
    submitVoiceBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      let finalTranscript = recordedTranscript;
      const fallbackInput = document.getElementById('voiceFallbackInput');
      if (fallbackInput) {
        finalTranscript = fallbackInput.value.trim();
      }

      if (!finalTranscript) {
        alert('Tulis/ucapkan jawaban Anda terlebih dahulu!');
        return;
      }

      submitVoiceBtn.disabled = true;
      submitVoiceBtn.textContent = 'MENGEVALUASI SUARA...';

      try {
        const response = await fetch('/api/v1/verify-voice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            transcript: finalTranscript,
            expectedKeywords: expectedKeywords
          })
        });

        const body = await response.json();
        const voiceResult = body.data;

        alert(voiceResult.feedback);
        voiceModal.classList.add('hidden');

        // Grade PG
        let correctCount = 0;
        let totalPg = 0;
        questions.forEach((q, idx) => {
          if (q.type === 'multiple_choice') {
            totalPg++;
            if (userAnswers[idx] === q.correct_answer) {
              correctCount++;
            }
          }
        });

        if (voiceResult.passed) {
          // Lolos tantangan suara!
          saveQuizSuccess(correctCount, totalPg, { verified: true, message: 'Integritas dipulihkan via Verifikasi Suara.' });
        } else {
          // Gagal tantangan suara!
          saveQuizFailed(correctCount, totalPg, voiceResult.feedback);
        }
      } catch (err) {
        console.error('Voice verify error:', err);
        alert('Terjadi kesalahan jaringan saat mengevaluasi suara.');
        voiceModal.classList.add('hidden');
        saveQuizFailed(0, 4, 'Verifikasi suara terlewat / gagal.');
      }
    });
  }

  // ── 11. Finish States ──
  function saveQuizSuccess(correct, total, integrityData) {
    // 1. Simpan Completed status ke LocalStorage
    let completed = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completed = JSON.parse(savedSlugs);
      } catch (err) {
        console.error('Error parsing completedSlugs in saveQuizSuccess:', err);
      }
    }
    const keyToSave = moduleId ? `quiz-module-${moduleId}` : slug;
    if (!completed.includes(keyToSave)) {
      completed.push(keyToSave);
      localStorage.setItem('completedSlugs', JSON.stringify(completed));
    }

    // 2. Naikkan skor integritas (max 100)
    const integrityRaw = localStorage.getItem('integrityScore');
    let score = 100;
    if (integrityRaw && integrityRaw !== 'undefined') {
      const parsed = parseInt(integrityRaw, 10);
      if (!isNaN(parsed)) {
        score = parsed;
      }
    }
    score = Math.min(100, score + 4);
    localStorage.setItem('integrityScore', score.toString());

    // 3. Render Output Hasil
    renderResultView(true, correct, total, integrityData.message, score);
  }

  function saveQuizFailed(correct, total, feedback) {
    // 1. Simpan completed status (karena kuis dikerjakan selesai)
    let completed = [];
    const savedSlugs = localStorage.getItem('completedSlugs');
    if (savedSlugs && savedSlugs !== 'undefined') {
      try {
        completed = JSON.parse(savedSlugs);
      } catch (err) {
        console.error('Error parsing completedSlugs in saveQuizFailed:', err);
      }
    }
    const keyToSave = moduleId ? `quiz-module-${moduleId}` : slug;
    if (!completed.includes(keyToSave)) {
      completed.push(keyToSave);
      localStorage.setItem('completedSlugs', JSON.stringify(completed));
    }

    // 2. Turunkan skor integritas (-15)
    const integrityRaw = localStorage.getItem('integrityScore');
    let score = 100;
    if (integrityRaw && integrityRaw !== 'undefined') {
      const parsed = parseInt(integrityRaw, 10);
      if (!isNaN(parsed)) {
        score = parsed;
      }
    }
    score = Math.max(0, score - 15);
    localStorage.setItem('integrityScore', score.toString());

    renderResultView(false, correct, total, feedback, score);
  }

  function renderResultView(passed, correct, total, reason, finalScore) {
    quizQuestionTitle.textContent = 'Hasil Evaluasi Kuis';
    
    let heading = passed 
      ? '<h2 class="text-3xl font-black text-green-600 uppercase mb-2">🎉 INTEGRITAS TERVERIFIKASI</h2>' 
      : '<h2 class="text-3xl font-black text-red-600 uppercase mb-2">❌ INTEGRITAS GAGAL</h2>';

    let message = passed
      ? 'Selamat! Anda menyelesaikan modul ini secara otentik.'
      : 'Perhatian: Kami mendeteksi anomali integritas yang tidak lolos pembuktian suara.';

    quizOptionsList.innerHTML = `
      <div class="border-4 border-textMain p-8 bg-white shadow-brutal w-full text-left">
        ${heading}
        <p class="text-sm font-bold text-textMuted uppercase mb-6">${message}</p>
        
        <div class="grid md:grid-cols-3 gap-4 mb-8">
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">PG SCORE</span>
            <span class="text-3xl font-black text-brandViolet">${correct} / ${total}</span>
          </div>
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">INTEGRITY STATUS</span>
            <span class="text-lg font-black uppercase ${passed ? 'text-green-600' : 'text-red-600'}">${passed ? 'PASSED' : 'FLAGGED'}</span>
          </div>
          <div class="border-2 border-textMain p-4 text-center bg-gray-50">
            <span class="text-xs font-bold text-textMuted uppercase block">CURRENT GLOBAL SCORE</span>
            <span class="text-3xl font-black text-brandOrange">${finalScore} / 100</span>
          </div>
        </div>

        <div class="border-2 border-textMain p-4 rounded-lg bg-gray-50 text-xs font-mono text-gray-700 leading-relaxed mb-6">
          <p class="font-bold text-textMain uppercase mb-1">Catatan Analisis Integritas:</p>
          <p>"${reason}"</p>
        </div>

        <button type="button" id="finishQuizBtn" class="w-full py-4 bg-brandOrange text-white border-2 border-textMain font-black uppercase shadow-brutal hover:bg-textMain transition text-center">
          Selesai & Kembali Ke Dashboard
        </button>
      </div>
    `;

    document.getElementById('finishQuizBtn').onclick = (e) => {
      e.preventDefault();
      window.location.href = 'myPath.html';
    };
  }
});
