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

console.log(`Running ${testFiles.length} test files with tsx --test...\n`);

const isWindows = process.platform === 'win32';
let filesPassed = 0;
let filesFailed = 0;
let totalTestsRun = 0;
let totalTestsPassed = 0;
let totalTestsFailed = 0;

for (const file of testFiles) {
  const result = spawnSync(
    isWindows ? 'npx.cmd' : 'npx',
    ['tsx', '--test', file],
    { encoding: 'utf-8', shell: isWindows }
  );

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // Parse total tests and pass/fail from Node test runner output
  const output = stdout + '\n' + stderr;
  const passMatches = [...output.matchAll(/ℹ pass (\d+)/g)];
  const failMatches = [...output.matchAll(/ℹ fail (\d+)/g)];

  // Last match in the file output represents the file total
  if (passMatches.length > 0) {
    const lastPass = parseInt(passMatches[passMatches.length - 1][1], 10);
    totalTestsPassed += lastPass;
  }
  if (failMatches.length > 0) {
    const lastFail = parseInt(failMatches[failMatches.length - 1][1], 10);
    totalTestsFailed += lastFail;
  }

  if (result.status !== 0) {
    filesFailed++;
    console.error(`FAILED: ${file}`);
  } else {
    filesPassed++;
  }
}

totalTestsRun = totalTestsPassed + totalTestsFailed;

console.log(`\n========================================`);
console.log(`Test Execution Summary:`);
console.log(`  Test Files: ${filesPassed} passed, ${filesFailed} failed (Total: ${testFiles.length})`);
console.log(`  Tests:      ${totalTestsPassed} passed, ${totalTestsFailed} failed (Total: ${totalTestsRun})`);
console.log(`========================================\n`);

process.exit(filesFailed > 0 ? 1 : 0);

