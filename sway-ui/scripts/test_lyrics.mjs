import { parseLRC, findActiveIndex, synthesizeWordTimings } from './sway-ui/lib/lyric-parser.js';
import { getLyricsCSSVars } from './sway-ui/store/useLyricsSettings.js';

console.log("=== Testing Lyrics Engine & Settings ===");

// 1. Test getLyricsCSSVars
const defaultVars = getLyricsCSSVars({
  fontSize: 'lg',
  lineHeight: 'normal',
  fontFamily: 'noto',
  contrast: 'medium',
  blur: 'light',
  align: 'left',
});
console.log("Default CSS Vars:", defaultVars);

const xlCenteredVars = getLyricsCSSVars({
  fontSize: 'xl',
  lineHeight: 'relaxed',
  fontFamily: 'mukta',
  contrast: 'high',
  blur: 'strong',
  align: 'center',
});
console.log("XL Centered CSS Vars:", xlCenteredVars);

// Check that both --blyrics and --lyrics are present and align centers flex
if (!xlCenteredVars['--blyrics-font-size'] || !xlCenteredVars['--lyrics-font-size']) {
  throw new Error("Missing font size variables!");
}
if (xlCenteredVars['--lyrics-justify-content'] !== 'center' || xlCenteredVars['--lyrics-text-align'] !== 'center') {
  throw new Error("Alignment not properly mapped to justify-content and text-align!");
}

// 2. Test word synthesis for plain lyrics
const lineText = "Jab Zid Pe Aa Gayi Parvati";
const synthesized = synthesizeWordTimings(lineText, 10.0, 14.0);
console.log("Synthesized words:", synthesized);
if (synthesized.length !== 6) {
  throw new Error(`Expected 6 words, got ${synthesized.length}`);
}
if (synthesized[0].startTime !== 10 || synthesized[synthesized.length - 1].endTime !== 14) {
  throw new Error("Synthesized boundary mismatch!");
}

// 3. Test findActiveIndex progression
const mockLines = [
  { time: 0, endTime: 3, text: "Line 1", words: [] },
  { time: 3, endTime: 6, text: "Line 2", words: [] },
  { time: 6, endTime: 10, text: "Line 3", words: [] },
];
console.log("Active idx at 0.5s:", findActiveIndex(0.5, mockLines)); // 0
console.log("Active idx at 3.5s:", findActiveIndex(3.5, mockLines)); // 1
console.log("Active idx at 7.0s:", findActiveIndex(7.0, mockLines)); // 2

if (findActiveIndex(3.5, mockLines) !== 1) {
  throw new Error("findActiveIndex failed to find line 2!");
}

console.log("=== ALL LOGIC TESTS PASSED ===");
