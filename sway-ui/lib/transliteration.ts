/**
 * transliteration.ts
 * Re-exports the unified transliteration engine from @/lib/lyrics-engine/transliteration
 */

export { isDevanagariScript as isDevanagari } from './lyrics-engine/transliteration';
export { romanizeDevanagariWord as devanagariToRoman, romanizeMixedText } from './lyrics-engine/transliteration';
