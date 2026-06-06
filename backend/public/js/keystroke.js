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

if (connectWalletBtn) {
  connectWalletBtn.addEventListener('connect', () => {
    console.log('Connecting wallet...');
  });
}
