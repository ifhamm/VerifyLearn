/**
 * Syntax gate for CI: runs `node --check` over every JS file in src/,
 * public/js/ and tests/. Exits non-zero if any file fails.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}

walk(path.join(root, 'src'));
walk(path.join(root, 'public', 'js'));
walk(path.join(root, 'tests'));
if (fs.existsSync(path.join(root, 'scripts'))) walk(path.join(root, 'scripts'));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error('SYNTAX FAIL:', path.relative(root, file));
    console.error(err.stderr ? err.stderr.toString() : err.message);
  }
}

console.log(`Syntax check: ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
