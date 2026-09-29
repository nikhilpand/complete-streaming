import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(__dirname, '..', 'tests');

const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => path.join('tests', f));

console.log(`Running ${testFiles.length} test files with tsx --test...`);

const isWindows = process.platform === 'win32';
let totalPassed = 0;
let totalFailed = 0;

for (const file of testFiles) {
  const result = spawnSync(
    isWindows ? 'npx.cmd' : 'npx',
    ['tsx', '--test', file],
    { stdio: 'inherit', shell: isWindows }
  );
  if (result.status !== 0) {
    totalFailed++;
    console.error(`FAILED: ${file}`);
  } else {
    totalPassed++;
  }
}

console.log(`\n========================================`);
console.log(`Test Files: ${totalPassed} passed, ${totalFailed} failed (Total: ${testFiles.length})`);
console.log(`========================================\n`);

process.exit(totalFailed > 0 ? 1 : 0);
