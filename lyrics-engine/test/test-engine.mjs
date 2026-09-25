/**
 * Automated Verification Test for Standalone Lyrics Engine
 */

import { LyricsEngine, Normalizer, LrcParser } from '../src/index.js';

async function runTests() {
  console.log('🧪 Starting Standalone Lyrics Engine Test Suite...\n');

  // Test 1: Normalizer
  console.log('1. Testing Normalizer:');
  const dirtyTitle = 'Save Your Tears (Remix) [feat. Ariana Grande] - Live';
  const clean = Normalizer.cleanTitle(dirtyTitle);
  console.log(`   Original: "${dirtyTitle}"`);
  console.log(`   Cleaned:  "${clean}"`);
  if (clean !== 'Save Your Tears') {
    throw new Error(`Normalizer failed: expected "Save Your Tears", got "${clean}"`);
  }
  console.log('   ✓ Normalizer Passed\n');

  // Test 2: LRC & Syllable Parser
  console.log('2. Testing LRC & Syllable Parser:');
  const sampleLrc = `
[00:05.00] In the beginning
[00:09.50] <00:09.50> Fast <00:10.00> forward <00:10.50> now
[00:14.00] The end
  `.trim();
  const parsed = LrcParser.parse(sampleLrc);
  console.log(`   Lines parsed: ${parsed.lines.length}`);
  console.log(`   Has syllables: ${parsed.hasSyllables}`);
  if (parsed.lines.length !== 3) throw new Error('Parser failed line count');
  if (parsed.lines[0].time !== 5000) throw new Error('Timestamp incorrect');
  if (!parsed.lines[0].words || parsed.lines[0].words.length !== 3) {
    throw new Error('Syllable synthesis failed for line 1');
  }
  console.log('   Line 1 synthesized words:', parsed.lines[0].words.map(w => w.text));
  console.log('   ✓ LrcParser Passed\n');

  // Test 3: Live API Cascading Engine Fetch
  console.log('3. Testing Live Cascading Engine Query:');
  const engine = new LyricsEngine();

  const testTrack = {
    title: 'Starboy (feat. Daft Punk)',
    artist: 'The Weeknd, Daft Punk',
    duration: 230
  };

  console.log(`   Fetching lyrics for "${testTrack.title}"...`);
  const lyrics = await engine.fetchLyrics(testTrack);

  if (!lyrics || !lyrics.lines.length) {
    throw new Error('Failed to retrieve lyrics from providers');
  }

  console.log(`   ✓ Provider: ${lyrics.provider}`);
  console.log(`   ✓ Total Lines: ${lyrics.lines.length}`);
  console.log(`   ✓ Sample Line 3: "${lyrics.lines[3]?.text}" at ${lyrics.lines[3]?.time}ms`);

  // Test 4: Real-time Timeline Progress Tracking
  console.log('\n4. Testing Real-time Playback Tracking:');
  let detectedLine = null;
  engine.on('lineChange', ({ index, line }) => {
    detectedLine = { index, text: line?.text };
  });

  // Jump to 25 seconds
  engine.updateProgress(25000);
  console.log(`   Timeline at 25.0s -> Active line: "${detectedLine?.text}" (index ${detectedLine?.index})`);
  if (!detectedLine) throw new Error('Playback tracking failed to find line at 25s');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! The engine is 100% functional.\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
