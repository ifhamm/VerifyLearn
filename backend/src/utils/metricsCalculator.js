// Utility functions for calculating WPM and detecting text pastes

exports.calculateWPM = (keystrokes) => {
  if (!Array.isArray(keystrokes) || keystrokes.length === 0) return 0;
  // Compute from keystroke duration data: first to last event
  const first = keystrokes[0];
  const last = keystrokes[keystrokes.length - 1];
  if (!first || !last || typeof first.time !== 'number' || typeof last.time !== 'number') return 0;
  const durationMs = last.time - first.time;
  if (durationMs <= 0) return 0;
  // Standard WPM = (characters / 5) / (duration in minutes)
  // Use keystroke count as rough character proxy (each event = 1 char interaction)
  const charCount = keystrokes.filter((e) => e && e.type === 'keydown').length || keystrokes.length;
  const minutes = durationMs / 60000;
  const wpm = Math.round((charCount / 5) / minutes);
  return wpm || 0;
};

exports.detectPaste = (event) => {
  return !!(event && event.pasteDetected);
};
