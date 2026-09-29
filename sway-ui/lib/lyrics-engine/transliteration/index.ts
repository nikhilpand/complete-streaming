/**
 * index.ts
 * Transliteration Subsystem Entrypoint with Token-Level Mixed-Script Preservation
 * Supports Hindi (Devanagari) and Punjabi (Gurmukhi) alongside English / Latin.
 */

import {
  isDevanagariScript,
  isGurmukhiScript,
  isNonLatinScript,
} from './detector';
import { romanizeDevanagariWord } from './romanizer';
import { romanizeGurmukhiWord, romanizeGurmukhiText } from './gurmukhiRomanizer';
import { LyricsLine } from '../types';

export * from './detector';
export * from './romanizer';
export * from './gurmukhiRomanizer';

/**
 * Romanizes a line while preserving English/Latin tokens verbatim.
 * Supports Devanagari (Hindi) and Gurmukhi (Punjabi).
 */
export function romanizeMixedText(text: string, capitalizeFirst: boolean = true): string {
  if (!text || !isNonLatinScript(text)) {
    return text;
  }

  // Tokenize preserving spaces, punctuation, and Unicode marks (\p{M})
  const tokens = text.split(/([^\p{L}\p{M}\p{N}]+)/u);
  const romanizedTokens = tokens.map((token) => {
    // If token contains Devanagari characters, romanize it
    if (isDevanagariScript(token)) {
      return romanizeDevanagariWord(token);
    }
    // If token contains Gurmukhi characters, romanize it
    if (isGurmukhiScript(token)) {
      return romanizeGurmukhiWord(token);
    }
    // English/Latin or punctuation: return verbatim
    return token;
  });

  const joined = romanizedTokens
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Capitalize the first letter of each lyric line for clean typography
  if (capitalizeFirst) {
    return joined.replace(/(^\s*[a-z])/g, (m) => m.toUpperCase());
  }
  return joined;
}

/**
 * Enriches a list of LyricsLines with dual storage (original + romanized)
 */
export function enrichLinesWithRomanization(lines: LyricsLine[]): {
  lines: LyricsLine[];
  hasRomanizedContent: boolean;
} {
  let hasRomanized = false;

  for (const line of lines) {
    if (line.original && isNonLatinScript(line.original)) {
      line.romanized = romanizeMixedText(line.original, true);
      hasRomanized = true;

      // Also enrich words if word sync exists
      if (line.words && line.words.length > 0) {
        for (const w of line.words) {
          if (w.text && isNonLatinScript(w.text)) {
            w.romanized = romanizeMixedText(w.text, false);
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
