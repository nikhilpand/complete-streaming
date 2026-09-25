/**
 * index.ts
 * Transliteration Subsystem Entrypoint with Token-Level Mixed-Script Preservation (Section 27 & 28)
 */

import { isDevanagariScript } from './detector';
import { romanizeDevanagariWord } from './romanizer';
import { LyricsLine } from '../types';

export * from './detector';
export * from './romanizer';

/**
 * Romanizes a line while preserving English/Latin tokens verbatim (Section 28)
 */
export function romanizeMixedText(text: string): string {
  if (!text || !isDevanagariScript(text)) {
    return text;
  }

  // Tokenize preserving spaces and punctuation
  const tokens = text.split(/([^\p{L}\p{N}]+)/u);
  const romanizedTokens = tokens.map((token) => {
    // If token contains Devanagari characters, romanize it
    if (isDevanagariScript(token)) {
      return romanizeDevanagariWord(token);
    }
    // If token is already English / Latin / punctuation, preserve verbatim
    return token;
  });

  return romanizedTokens.join('').trim();
}

/**
 * Enriches a list of LyricsLines with dual storage (original + romanized) (Section 27)
 */
export function enrichLinesWithRomanization(lines: LyricsLine[]): {
  lines: LyricsLine[];
  hasRomanizedContent: boolean;
} {
  let hasRomanized = false;

  for (const line of lines) {
    if (line.original && isDevanagariScript(line.original)) {
      line.romanized = romanizeMixedText(line.original);
      hasRomanized = true;

      // Also enrich words if word sync exists
      if (line.words && line.words.length > 0) {
        for (const w of line.words) {
          if (w.text && isDevanagariScript(w.text)) {
            w.romanized = romanizeMixedText(w.text);
          }
        }
      }
    }
  }

  return {
    lines,
    hasRomanizedContent: hasRomanized,
  };
}
