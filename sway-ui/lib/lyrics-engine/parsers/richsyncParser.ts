/**
 * richsyncParser.ts
 * Parser & Validator for Genuine Word/Syllable RichSync Timings (Section 16)
 */

import { RichSyncLine, LyricsLine, LyricsWord } from '../types';

export interface RichSyncParseResult {
  lines: LyricsLine[];
  isWordSyncValid: boolean;
}

export function parseRichSync(richSync: RichSyncLine[]): RichSyncParseResult {
  if (!Array.isArray(richSync) || richSync.length === 0) {
    return { lines: [], isWordSyncValid: false };
  }

  const lines: LyricsLine[] = [];
  let isOverallWordTimingValid = true;

  for (let lIdx = 0; lIdx < richSync.length; lIdx++) {
    const rawLine = richSync[lIdx];
    const lineStartMs = Math.round(Number(rawLine.ts || 0) * 1000);
    const lineEndMs = Math.round(Number(rawLine.te || (rawLine.ts + 4)) * 1000);
    const rawWords = Array.isArray(rawLine.l) ? rawLine.l : [];

    const words: LyricsWord[] = [];
    let fullOriginalText = '';
    let lastWordStart = lineStartMs;
    let lineWordsValid = true;

    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const wObj = rawWords[wIdx];
      const wordText = String(wObj.c || '');
      const offsetMs = Math.round(Number(wObj.o || 0) * 1000);
      const startMs = lineStartMs + offsetMs;

      // Word end is either the next word's start, or the line end
      const nextWord = rawWords[wIdx + 1];
      const nextOffsetMs = nextWord ? Math.round(Number(nextWord.o || 0) * 1000) : (lineEndMs - lineStartMs);
      const endMs = Math.min(lineEndMs, lineStartMs + nextOffsetMs);

      // Section 16 Validation Rules:
      // 1. Monotonic start time
      if (startMs < lastWordStart - 50) {
        lineWordsValid = false;
      }
      // 2. End >= Start
      if (endMs < startMs) {
        lineWordsValid = false;
      }
      // 3. Inside line bounds
      if (startMs < lineStartMs - 500 || endMs > lineEndMs + 1000) {
        lineWordsValid = false;
      }

      fullOriginalText += (wIdx > 0 ? ' ' : '') + wordText;
      words.push({
        text: wordText,
        startMs: Math.max(lineStartMs, startMs),
        endMs: Math.max(startMs, endMs),
      });

      lastWordStart = startMs;
    }

    if (!lineWordsValid) {
      isOverallWordTimingValid = false;
    }

    const trimmedText = fullOriginalText.trim();
    lines.push({
      id: lIdx,
      startMs: lineStartMs,
      endMs: Math.max(lineStartMs, lineEndMs),
      original: trimmedText,
      words: lineWordsValid ? words : [],
      isInstrumental: trimmedText.length === 0 || trimmedText === '♪',
    });
  }

  return {
    lines,
    isWordSyncValid: isOverallWordTimingValid,
  };
}
