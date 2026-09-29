/**
 * transliteration.ts
 * Re-exports the unified transliteration engine from @/lib/lyrics-engine/transliteration
 * Focused on Hindi (Devanagari) and Punjabi (Gurmukhi) alongside English / Latin.
 */

export {
  isDevanagariScript as isDevanagari,
  isGurmukhiScript as isGurmukhi,
  isNonLatinScript,
  detectScript,
} from './lyrics-engine/transliteration';

export {
  romanizeDevanagariWord as devanagariToRoman,
  romanizeGurmukhiWord as gurmukhiToRoman,
  romanizeGurmukhiText,
  romanizeMixedText,
} from './lyrics-engine/transliteration';
