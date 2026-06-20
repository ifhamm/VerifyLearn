// public/js/material.js

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

document.addEventListener('DOMContentLoaded', async () => {
  // Parse Query Parameters
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role') || 'backend';
  const slug = params.get('slug');

  // DOM Elements
  const pathTitle = document.getElementById('pathTitle');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const sidebarTopics = document.getElementById('sidebarTopics');
  
  const materialTitle = document.getElementById('materialTitle');
  const materialContent = document.getElementById('materialContent');
  
  const backBtn = document.getElementById('backBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  // Redirect if no path generated yet
  const savedPlanRaw = localStorage.getItem('learningPlan');
  let plan = null;
  if (savedPlanRaw && savedPlanRaw !== 'undefined') {
    try {
      plan = JSON.parse(savedPlanRaw);
    } catch (err) {
      console.error('Error parsing learningPlan:', err);
      localStorage.removeItem('learningPlan');
    }
  }
  
  if (!plan) {
    // If user opened page directly, fetch default path so it does not crash
    try {
      const res = await fetch(`/api/v1/learning-path?role=${role}&duration=2`);
      const body = await res.json();
      plan = body.data;
      localStorage.setItem('learningPlan', JSON.stringify(plan));
      localStorage.setItem('completedSlugs', JSON.stringify([]));
    } catch (err) {
      console.error('Failed to load fallback plan:', err);
    }
  }

  // Get completed list
  let completedSlugs = [];
  const savedSlugs = localStorage.getItem('completedSlugs');
  if (savedSlugs && savedSlugs !== 'undefined') {
    try {
      completedSlugs = JSON.parse(savedSlugs);
    } catch (err) {
      console.error('Error parsing completedSlugs:', err);
    }
  }

  // Update Path UI Header Title
  if (pathTitle) {
    const roleLabel = role === 'frontend' ? 'Frontend Developer' : role === 'backend' ? 'Backend Developer' : 'Fullstack Developer';
    pathTitle.textContent = `${roleLabel} Path`;
  }

  // Fetch list of all materials in path
  let materialsList = [];
  try {
    const res = await fetch(`/api/v1/material?role=${role}`);
    const body = await res.json();
    materialsList = body.data || [];
  } catch (err) {
    console.error('Error fetching materials list:', err);
  }

  // Filter based on local plan and language choice
  const selectedLang = localStorage.getItem('selectedLanguage');
  const languageSlugs = ['javascript', 'go', 'python', 'ruby', 'java', 'c', 'php', 'rust'];

  let filteredMaterialsList = materialsList.filter(m => {
    // First, check in local plan if status is 'dilewati'
    if (plan && plan.materials) {
      const pm = plan.materials.find(item => item.slug === m.slug);
      if (pm && pm.status === 'dilewati') return false;
    }
    // Second, if selected language is set, filter out other languages
    if (selectedLang && languageSlugs.includes(m.slug) && m.slug !== selectedLang) {
      return false;
    }
    return true;
  });

  // Merge status from plan.materials into filtered list so sidebar tags work
  if (plan && plan.materials) {
    filteredMaterialsList = filteredMaterialsList.map(m => {
      const pm = plan.materials.find(item => item.slug === m.slug);
      return { ...m, status: pm ? pm.status : 'pilihan' };
    });
  }

  // If no slug is specified in query param, redirect to the first material
  if (!slug && filteredMaterialsList.length > 0) {
    window.location.replace(`materi.html?role=${role}&slug=${filteredMaterialsList[0].slug}`);
    return;
  }

  // Set up global selection helper for Pick a Language
  window.selectLanguage = (langSlug) => {
    localStorage.setItem('selectedLanguage', langSlug);
    alert('Bahasa pemrograman berhasil dipilih: ' + langSlug.toUpperCase() + '. Kurikulum Anda telah disesuaikan!');
    window.location.reload();
  };

  // Group filtered list into 4 modules
  const total = filteredMaterialsList.length;
  const chunkSize = Math.ceil(total / 4);
  const modules = [
    { id: 1, title: 'Module I: Fundamentals & Introduction', items: filteredMaterialsList.slice(0, chunkSize) },
    { id: 2, title: 'Module II: Core Concepts', items: filteredMaterialsList.slice(chunkSize, 2 * chunkSize) },
    { id: 3, title: 'Module III: Advanced Exploration', items: filteredMaterialsList.slice(2 * chunkSize, 3 * chunkSize) },
    { id: 4, title: 'Module IV: Projects & Enrichment', items: filteredMaterialsList.slice(3 * chunkSize) }
  ].filter(mod => mod.items.length > 0);

  // Render Sidebar
  renderSidebar(modules, slug, completedSlugs);
  
  // Render Progress
  updateProgressUI(modules, slug, completedSlugs);

  // Fetch Active Material Content
  if (slug) {
    try {
      const res = await fetch(`/api/v1/material?role=${role}&slug=${slug}`);
      if (!res.ok) throw new Error('Material not found');
      const body = await res.json();
      const mData = body.data;
      
      const isCurrentDone = completedSlugs.includes(slug);
      if (isCurrentDone) {
        materialTitle.innerHTML = `${mData.title} <span class="ml-3 inline-flex items-center px-3 py-1 bg-green-100 text-green-700 text-xs font-black uppercase rounded-full border border-green-200">Completed ✓</span>`;
      } else {
        materialTitle.textContent = mData.title;
      }
      materialContent.innerHTML = formatMarkdown(mData.expanded_content || mData.content);
      
      // Inject Pick a Language grid if current material is Pick a Language
      if (slug === 'pick-a-backend-language') {
        const languages = [
          { name: 'JavaScript (Node.js)', slug: 'javascript', desc: 'Sangat populer, ekosistem besar, asinkronus.', color: 'bg-[#F7DF1E]' },
          { name: 'Python', slug: 'python', desc: 'Sintaks bersih, ramah pemula, kaya pustaka AI/data.', color: 'bg-[#3776AB] text-white' },
          { name: 'Go (Golang)', slug: 'go', desc: 'Efisien, performa tinggi, konkurensi bawaan dari Google.', color: 'bg-[#00ADD8] text-white' },
          { name: 'Ruby', slug: 'ruby', desc: 'Elegan, fokus pada produktivitas dan kebahagiaan developer.', color: 'bg-[#CC342D] text-white' },
          { name: 'Java', slug: 'java', desc: 'Handal, berorientasi objek, standar aplikasi enterprise.', color: 'bg-[#007396] text-white' },
          { name: 'C#', slug: 'c', desc: 'Modern, didukung Microsoft, sangat kuat untuk ekosistem .NET.', color: 'bg-[#239120] text-white' },
          { name: 'PHP', slug: 'php', desc: 'Mudah dipelajari, mendominasi web hosting global, modern.', color: 'bg-[#777BB4] text-white' },
          { name: 'Rust', slug: 'rust', desc: 'Performa super cepat, aman memori tanpa garbage collector.', color: 'bg-[#000000] text-white' }
        ];

        let gridHtml = `
          <div class="mt-8 border-4 border-textMain p-6 bg-white shadow-brutal">
            <h3 class="text-2xl font-black uppercase mb-4 text-gray-900">Pilih Bahasa Pemrograman Anda:</h3>
            <p class="text-sm text-textMuted mb-6">Pilihan Anda akan menyesuaikan seluruh kurikulum berikutnya secara otomatis.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        `;

        languages.forEach(lang => {
          const isSelected = selectedLang === lang.slug;
          const activeClass = isSelected 
            ? 'border-4 border-brandOrange bg-orange-50 ring-4 ring-brandOrange/20' 
            : 'border-2 border-textMain bg-white hover:bg-gray-50';
          
          gridHtml += `
            <div class="p-5 rounded-xl transition cursor-pointer select-none relative group flex flex-col justify-between ${activeClass}" onclick="selectLanguage('${lang.slug}')">
              <div>
                <div class="flex items-center gap-3 mb-2">
                  <span class="px-2.5 py-1 text-xs font-black uppercase border-2 border-textMain rounded ${lang.color}">${lang.name}</span>
                  ${isSelected ? '<span class="text-xs font-black text-brandOrange uppercase bg-orange-50 border border-brandOrange/50 px-2 py-0.5 rounded">TERPILIH</span>' : ''}
                </div>
                <p class="text-xs font-medium text-textMuted leading-relaxed mt-2">${lang.desc}</p>
              </div>
              <div class="mt-4 text-xs font-black uppercase text-brandOrange tracking-wide group-hover:translate-x-1 transition-transform">
                Pilih Bahasa Ini &rarr;
              </div>
            </div>
          `;
        });

        gridHtml += `
            </div>
          </div>
        `;
        materialContent.innerHTML += gridHtml;
      }

      if (window.hljs) {
        try {
          window.hljs.highlightAll();
        } catch (e) {
          console.error("Highlight.js failed to highlight:", e);
        }
      }
      
      // Setup Navigation Flow
      setupNavigation(modules, slug);
    } catch (err) {
      materialTitle.textContent = 'Material Not Found';
      materialContent.innerHTML = `<p class="text-red-500 font-bold">Error: ${err.message}</p>`;
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';
    }
  }

  // Setup Back Button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'homePage.html';
    });
  }

  // ── Helper: Render Navigation Buttons ──
  function setupNavigation(modulesList, currentSlug) {
    // Find current module and local index
    let modIdx = -1;
    let localIdx = -1;

    for (let i = 0; i < modulesList.length; i++) {
      const idx = modulesList[i].items.findIndex(m => m.slug === currentSlug);
      if (idx !== -1) {
        modIdx = i;
        localIdx = idx;
        break;
      }
    }

    if (modIdx === -1) return;

    const modObj = modulesList[modIdx];

    // Prev Button
    if (prevBtn) {
      if (localIdx > 0) {
        prevBtn.style.display = 'flex';
        prevBtn.onclick = () => {
          window.location.href = `materi.html?role=${role}&slug=${modObj.items[localIdx - 1].slug}`;
        };
      } else if (modIdx > 0) {
        // Prev goes to the previous module's quiz
        prevBtn.style.display = 'flex';
        const prevMod = modulesList[modIdx - 1];
        const lastItemOfPrevMod = prevMod.items[prevMod.items.length - 1];
        prevBtn.onclick = () => {
          window.location.href = `quiz.html?role=${role}&module=${prevMod.id}&slug=${lastItemOfPrevMod.slug}`;
        };
      } else {
        prevBtn.style.display = 'none';
      }
    }

    function markCurrentCompleted() {
      if (!currentSlug) return;
      let completed = [];
      const saved = localStorage.getItem('completedSlugs');
      if (saved && saved !== 'undefined') {
        try {
          completed = JSON.parse(saved);
        } catch (e) {
          console.error('Error parsing completedSlugs:', e);
        }
      }
      if (!completed.includes(currentSlug)) {
        completed.push(currentSlug);
        localStorage.setItem('completedSlugs', JSON.stringify(completed));
      }
    }

    // Next Button
    if (nextBtn) {
      if (localIdx < modObj.items.length - 1) {
        nextBtn.innerHTML = `Next
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>`;
        nextBtn.onclick = () => {
          markCurrentCompleted();
          window.location.href = `materi.html?role=${role}&slug=${modObj.items[localIdx + 1].slug}`;
        };
      } else {
        // Last material of the module! Next points to the Module Quiz!
        nextBtn.innerHTML = `Practice Quiz! 🚀
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>`;
        nextBtn.onclick = () => {
          markCurrentCompleted();
          window.location.href = `quiz.html?role=${role}&module=${modObj.id}&slug=${currentSlug}`;
        };
      }
    }
  }

  // ── Helper: Update Progress Display ──
  function updateProgressUI(modulesList, currentSlug, completed) {
    if (!progressText || !progressBar) return;
    
    // Find active module
    const activeModIdx = modulesList.findIndex(mod => mod.items.some(m => m.slug === currentSlug));
    if (activeModIdx === -1) return;

    const activeMod = modulesList[activeModIdx];
    const totalModItems = activeMod.items.length;
    const completedModItems = activeMod.items.filter(m => completed.includes(m.slug)).length;

    const percent = totalModItems > 0 ? Math.min(100, Math.round((completedModItems / totalModItems) * 100)) : 0;

    progressText.textContent = `Progress ${percent}%`;
    progressBar.style.width = `${percent}%`;

    const romanNumerals = ['I', 'II', 'III', 'IV'];
    const activeModRoman = romanNumerals[activeModIdx] || (activeModIdx + 1);
    const progressLabel = progressText.previousElementSibling;
    if (progressLabel) {
      progressLabel.textContent = `Progress Modul ${activeModRoman}`;
    }
  }

  // ── Helper: Populate Sidebar topics ──
  function renderSidebar(modulesList, activeSlug, completed) {
    if (!sidebarTopics) return;
    sidebarTopics.innerHTML = '';

    const romanNumerals = ['I', 'II', 'III', 'IV'];

    modulesList.forEach((modObj, modIdx) => {
      const moduleWrapper = document.createElement('div');
      moduleWrapper.className = 'mb-6';

      const modLabel = document.createElement('p');
      modLabel.className = 'text-xs font-bold text-gray-400 tracking-wider mb-1 uppercase';
      modLabel.textContent = `MODULE ${romanNumerals[modIdx] || (modIdx + 1)}`;
      moduleWrapper.appendChild(modLabel);

      const modTitle = document.createElement('h3');
      modTitle.className = 'font-black text-sm text-gray-900 mb-3 border-b-2 border-gray-100 pb-1';
      modTitle.textContent = modObj.title;
      moduleWrapper.appendChild(modTitle);

      const topicList = document.createElement('ul');
      topicList.className = 'space-y-2';

      modObj.items.forEach((m, localIdx) => {
        const isActive = m.slug === activeSlug;
        const isDone = completed.includes(m.slug);
        const li = document.createElement('li');

        let cardStyle = 'w-full flex items-center justify-between px-3 py-2 text-gray-700 font-medium hover:bg-gray-50 border border-transparent rounded-lg transition text-left text-sm';
        let badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-[10px] shrink-0 font-bold';
        let tagBadge = '';

        if (isActive) {
          cardStyle = 'w-full flex items-center justify-between px-3 py-2 bg-orange-50 text-brandOrange font-black rounded-lg border border-brandOrange/30 transition text-left text-sm';
          badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-brandOrange text-white text-[10px] shrink-0 font-bold';
        } else if (isDone) {
          cardStyle = 'w-full flex items-center justify-between px-3 py-2 bg-green-50 text-green-700 font-bold rounded-lg border border-green-100 transition text-left text-sm';
          badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-green-500 text-white text-[10px] shrink-0 font-bold';
        } else {
          // Uncompleted and inactive
          if (m.status === 'wajib') {
            cardStyle = 'w-full flex items-center justify-between px-3 py-2 text-gray-900 bg-white font-bold hover:bg-orange-50/30 border border-brandOrange/30 rounded-lg transition text-left text-sm';
            badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-brandOrange/10 text-brandOrange border border-brandOrange/20 text-[10px] shrink-0 font-bold';
            tagBadge = '<span class="text-[9px] font-black text-brandOrange bg-orange-50 border border-brandOrange/20 px-1.5 py-0.5 rounded uppercase tracking-tight ml-2">Required</span>';
          } else { // pilihan / Optional
            cardStyle = 'w-full flex items-center justify-between px-3 py-2 text-gray-600 bg-white font-medium hover:bg-violet-50/30 border border-dashed border-brandViolet/30 rounded-lg transition text-left text-sm';
            badgeStyle = 'w-6 h-6 flex items-center justify-center rounded-full bg-brandViolet/10 text-brandViolet border border-brandViolet/20 text-[10px] shrink-0 font-bold';
            tagBadge = '<span class="text-[9px] font-black text-brandViolet bg-violet-50 border border-brandViolet/20 px-1.5 py-0.5 rounded uppercase tracking-tight ml-2">Optional</span>';
          }
        }

        const btn = document.createElement('a');
        btn.href = `materi.html?role=${role}&slug=${m.slug}`;
        btn.className = cardStyle;
        btn.innerHTML = `
          <div class="flex items-center gap-3 overflow-hidden">
            <span class="${badgeStyle}">${isDone && !isActive ? '✓' : (localIdx + 1)}</span>
            <span class="truncate">${m.title}</span>
          </div>
          ${tagBadge}
         `;
        li.appendChild(btn);
        topicList.appendChild(li);
      });



      moduleWrapper.appendChild(topicList);
      sidebarTopics.appendChild(moduleWrapper);
    });
  }

  // Helper to determine if a line looks like code
  function isCodeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // If the line starts with standard markdown structures, it's NOT a raw code line
    if (trimmed.startsWith('#') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('>') || /^\d+\.\s+/.test(trimmed)) {
      return false;
    }

    // If the line starts with "Sumber:" or looks like a URL only, it's NOT a code line
    if (trimmed.startsWith('Sumber:') || /^https?:\/\/[^\s]+$/.test(trimmed)) {
      return false;
    }

    // Common JS expressions and statements
    const jsPatterns = [
      /window\./,
      /document\./,
      /localStorage\./,
      /console\.(log|warn|error|info)/,
      /gtag\s*\(/,
      /dataLayer\./,
      /\bfunction\b/,
      /\bconst\b/,
      /\blet\b/,
      /\bvar\b/,
      /\btry\s*\{/,
      /\bcatch\s*\(.*\)\s*\{/,
      /^[A-Za-z0-9_]+\s*=\s*/, // assignments
      /^[A-Za-z0-9_]+\s*\([^)]*\)\s*;?$/, // simple function calls
      /^[}{]$/, // single braces
      /^\s*\}\s*catch\s*\(.*\)\s*\{\s*$/,
      /^\s*\}\s*finally\s*\{\s*$/,
      /\bif\s*\(.*\)\s*\{?/,
      /\belse\s*\{?/,
      /\bfor\s*\(.*\)/,
      /\bwhile\s*\(.*\)/,
      /\bswitch\s*\(.*\)/,
      /\bcase\s+.*:/,
      /\breturn\b/,
      /\bimport\b.*\bfrom\b/,
      /\brequire\s*\(/,
      /=>/, // arrow functions
      /;$/, // ends with semicolon
      /\.push\(/
    ];

    // Common CSS expressions
    const cssPatterns = [
      /@font-face/,
      /font-family\s*:/,
      /src\s*:\s*url\(/,
      /font-weight\s*:/,
      /font-style\s*:/,
      /font-display\s*:/,
      /tab-size\s*:/,
      /:\s*var\(--/,
      /pre,\s*code\s*\{/,
      /^:root\s*\{/,
      /^[a-z0-9_#.+-,\s]+\s*\{\s*$/i // css selector opening
    ];

    // Specific text patterns we want to make sure are NOT treated as code (false positives)
    const falsePositives = [
      /^[A-Za-z\s]+$/, // just plain words
      /^learning path/i,
      /roadmap/i,
      /roadmapsh/i,
      /^\d+$/, // numbers
      /^Skip to main content/i
    ];

    if (falsePositives.some(rx => rx.test(trimmed))) {
      return false;
    }

    const isJS = jsPatterns.some(rx => rx.test(trimmed));
    const isCSS = cssPatterns.some(rx => rx.test(trimmed));

    return isJS || isCSS;
  }

  // Preprocessor to wrap contiguous raw code lines in fenced blocks
  function autoFenceCode(text) {
    if (!text) return '';

    // 1. Preprocess specific merges to add newlines before code parts
    let cleanText = text;
    cleanText = cleanText.replace(/([a-zA-Z0-9_])window\.dataLayer/g, '$1\nwindow.dataLayer');
    cleanText = cleanText.replace(/([a-zA-Z0-9_])try\s*\{\s*document\.documentElement/g, '$1\ntry {\n  document.documentElement');
    cleanText = cleanText.replace(/([a-zA-Z0-9_])try\s*\{\s*if\s*\(localStorage/g, '$1\ntry {\n  if (localStorage');
    cleanText = cleanText.replace(/([a-zA-Z0-9_])function\s+gtag/g, '$1\nfunction gtag');
    cleanText = cleanText.replace(/([a-zA-Z0-9_])\(function\(i,s,o,g,r,a,m\)/g, '$1\n(function(i,s,o,g,r,a,m)');

    // 2. Identify and wrap raw code lines
    const lines = cleanText.split('\n');
    const result = [];
    let inCodeBlock = false;
    let codeBlockLines = [];
    let codeBlockLang = 'javascript';
    let inExistingFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          result.push('```' + codeBlockLang);
          result.push(...codeBlockLines);
          result.push('```');
          inCodeBlock = false;
          codeBlockLines = [];
        }
        inExistingFence = !inExistingFence;
        result.push(line);
        continue;
      }

      if (inExistingFence) {
        result.push(line);
        continue;
      }

      const isCode = isCodeLine(line);

      if (inCodeBlock) {
        const trimmed = line.trim();
        const isContinuation = trimmed === '' || 
                               /[{},;()[\]]/.test(trimmed) || 
                               /^\s+/.test(line) || 
                               /^[a-zA-Z0-9_-]+\s*:\s*/.test(trimmed); // object properties

        if (isCode || isContinuation) {
          codeBlockLines.push(line);
          if (/@font-face|font-family|src:\s*url/.test(line)) {
            codeBlockLang = 'css';
          }
        } else {
          // Close code block
          result.push('```' + codeBlockLang);
          result.push(...codeBlockLines);
          result.push('```');
          inCodeBlock = false;
          codeBlockLines = [];
          result.push(line);
        }
      } else {
        if (isCode) {
          inCodeBlock = true;
          codeBlockLang = 'javascript';
          if (/@font-face|font-family|src:\s*url/.test(line)) {
            codeBlockLang = 'css';
          }
          codeBlockLines.push(line);
        } else {
          result.push(line);
        }
      }
    }

    if (inCodeBlock) {
      result.push('```' + codeBlockLang);
      result.push(...codeBlockLines);
      result.push('```');
    }

    return result.join('\n');
  }

  // ── Simple Markdown to HTML Formatter ──
  function formatMarkdown(text) {
    if (!text) return '';
    
    // Auto-fence any raw code blocks first
    const fencedText = autoFenceCode(text);
    
    // Extract code blocks to protect them from splitting/formatting
    const codeBlocks = [];
    let html = fencedText.replace(/```(javascript|json|html|css|python|go)?\s*([\s\S]*?)\s*```/gim, (match, lang, code) => {
      const index = codeBlocks.length;
      const languageBadge = lang ? `<span class="absolute top-2 right-4 text-[10px] font-black uppercase text-gray-400 select-none">${lang}</span>` : '';
      const codeClass = lang ? `class="language-${lang}"` : '';
      
      // Escape HTML characters inside the code block
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const blockHtml = `<div class="relative group my-6"><pre class="bg-gray-900 text-gray-100 rounded-xl p-5 border-2 border-textMain shadow-brutal-sm overflow-x-auto font-mono text-sm leading-relaxed select-all"><code ${codeClass}>${escapedCode.trim()}</code></pre>${languageBadge}</div>`;
      
      codeBlocks.push(blockHtml);
      return `\n\n__CODE_BLOCK_${index}__\n\n`;
    });

    // Escape HTML characters in the rest of the text
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headings
    html = html.replace(/^### (.*$)/gim, '<h4 class="text-xl font-bold text-gray-900 mt-6 mb-2">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="text-2xl font-bold text-gray-900 mt-8 mb-4 border-b border-gray-200 pb-2">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="text-3xl font-black text-gray-900 mt-10 mb-6">$1</h2>');

    // Inline Code
    html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-brandOrange font-mono px-1.5 py-0.5 rounded text-sm border border-gray-200">$1</code>');

    // Bold text
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-extrabold text-gray-900">$1</strong>');

    // Bullet Lists
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-6 list-disc text-gray-700 mb-2 leading-relaxed">$1</li>');

    // Paragraphs
    html = html.split(/\n\n+/).map(p => {
      p = p.trim();
      if (!p) return '';
      // Skip wrapping if it is a heading, code block placeholder, pre block, or list item
      if (p.startsWith('<h') || p.startsWith('__CODE_BLOCK_') || p.startsWith('<pre') || p.startsWith('<li')) {
        return p;
      }
      return `<p class="text-gray-600 text-base mb-6 leading-relaxed">${p.replace(/\n/g, '<br />')}</p>`;
    }).join('\n');

    // Put code blocks back
    for (let i = 0; i < codeBlocks.length; i++) {
      html = html.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
    }

    return html;
  }
});
