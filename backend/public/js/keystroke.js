// Keystroke dynamics and paste detection script

const typingArea = document.getElementById('typingArea');
const wpmCounter = document.getElementById('wpmCounter');
const pasteDetector = document.getElementById('pasteDetector');
const connectWalletBtn = document.getElementById('connectWalletBtn');

let keystrokes = [];
let startTime = null;

if (typingArea) {
  typingArea.addEventListener('keydown', (e) => {
    if (!startTime) {
      startTime = Date.now();
    }
    
    // Capture keystroke event metadata
    keystrokes.push({
      key: e.key,
      time: Date.now(),
      type: 'keydown'
    });
    
    calculateWPM();
  });

  typingArea.addEventListener('keyup', (e) => {
    keystrokes.push({
      key: e.key,
      time: Date.now(),
      type: 'keyup'
    });
  });

  typingArea.addEventListener('paste', (e) => {
    pasteDetector.textContent = 'Paste status: Paste Detected ⚠️';
    pasteDetector.style.color = '#f87171'; // red-400
  });
}

function calculateWPM() {
  if (!startTime) return;
  const wordCount = typingArea.value.trim().split(/\s+/).filter(word => word.length > 0).length;
  const minutesPassed = (Date.now() - startTime) / 60000;
  const wpm = minutesPassed > 0 ? Math.round(wordCount / minutesPassed) : 0;
  wpmCounter.textContent = `WPM: ${wpm}`;
}

const materialSlugInput = document.getElementById('materialSlug');
const fetchMaterialBtn = document.getElementById('fetchMaterialBtn');
const fetchListBtn = document.getElementById('fetchListBtn');
const materialResult = document.getElementById('materialResult');

if (fetchMaterialBtn) {
  fetchMaterialBtn.addEventListener('click', async () => {
    const slug = materialSlugInput.value.trim();
    if (!slug) {
      materialResult.innerHTML = '<p class="text-slate-400">Masukkan slug materi terlebih dahulu atau gunakan tombol List Semua.</p>';
      return;
    }

    materialResult.innerHTML = '<p class="text-slate-400">Memuat materi...</p>';
    try {
      const response = await fetch(`/api/v1/material?role=backend&slug=${encodeURIComponent(slug)}`);
      const body = await response.json();
      renderMaterial(body);
    } catch (error) {
      materialResult.innerHTML = `<div class="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">Error: ${error.message}</div>`;
    }
  });
}

if (fetchListBtn) {
  fetchListBtn.addEventListener('click', async () => {
    materialResult.innerHTML = '<p class="text-slate-400">Memuat daftar materi...</p>';
    try {
      const response = await fetch('/api/v1/material?role=backend');
      const body = await response.json();
      renderMaterialList(body);
    } catch (error) {
      materialResult.innerHTML = `<div class="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">Error: ${error.message}</div>`;
    }
  });
}

function renderMaterial(body) {
  if (!body || body.error) {
    materialResult.innerHTML = `<div class="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">${body.error || 'Material tidak ditemukan.'}</div>`;
    return;
  }

  const data = body.data;
  const rows = Object.entries(data).map(([key, value]) => {
    const rendered = typeof value === 'string' ? value.replace(/\n/g, '<br />') : JSON.stringify(value);
    return `<div class="grid grid-cols-3 gap-4 py-2 border-b border-slate-800/60 last:border-none"><span class="font-semibold text-slate-300">${key}</span><div class="col-span-2 text-slate-200">${rendered}</div></div>`;
  }).join('');

  materialResult.innerHTML = `
    <div class="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 shadow-lg shadow-black/20">
      <div class="mb-4 text-slate-100 font-semibold text-lg">Material Detail</div>
      <div class="grid gap-2 text-slate-100">${rows}</div>
    </div>
    <div class="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 overflow-x-auto">
      <div class="font-semibold text-slate-100 mb-2">Raw JSON</div>
      <pre class="whitespace-pre-wrap break-words text-xs text-slate-200">${JSON.stringify(body, null, 2)}</pre>
    </div>
  `;
}

function renderMaterialList(body) {
  if (!body || body.error) {
    materialResult.innerHTML = `<div class="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">${body.error || 'Daftar materi tidak tersedia.'}</div>`;
    return;
  }

  const rows = (body.data || []).map((item) => `
    <tr class="border-b border-slate-800/60 hover:bg-slate-900/80">
      <td class="px-3 py-2 text-slate-200">${item.id || '-'}</td>
      <td class="px-3 py-2 text-slate-200">${item.slug || '-'}</td>
      <td class="px-3 py-2 text-slate-200">${item.title || '-'}</td>
      <td class="px-3 py-2 text-slate-200">${item.topic_type || '-'}</td>
    </tr>
  `).join('');

  materialResult.innerHTML = `
    <div class="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 shadow-lg shadow-black/20 overflow-x-auto">
      <div class="mb-4 text-slate-100 font-semibold text-lg">Daftar Materi</div>
      <table class="min-w-full text-left border-collapse text-sm">
        <thead>
          <tr class="border-b border-slate-800/60 text-slate-400 uppercase text-xs tracking-wide">
            <th class="px-3 py-2">ID</th>
            <th class="px-3 py-2">Slug</th>
            <th class="px-3 py-2">Title</th>
            <th class="px-3 py-2">Type</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

if (connectWalletBtn) {
  connectWalletBtn.addEventListener('connect', () => {
    console.log('Connecting wallet...');
  });
}
