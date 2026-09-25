/**
 * transliteration.ts
 * High-performance, zero-dependency Devanagari to Romanized English (Hinglish) transliterator.
 * Specifically tuned for natural-reading lyrics (e.g. "केसरिया" -> "Kesariya").
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // Nukta consonants
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
};

const MODIFIERS: Record<string, string> = {
  'ं': 'n',
  'ँ': 'n',
  'ः': 'h',
  'ऽ': '',
};

const VIRAMA = '्';
const NUKTA = '़';

/**
 * Checks if a string contains any Devanagari characters
 */
export function isDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Transliterator converting Devanagari text to natural Romanized English (Hinglish)
 */
export function devanagariToRoman(text: string): string {
  if (!text || !isDevanagari(text)) return text;

  let result = '';
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const char = text[i];
    const nextChar = i + 1 < len ? text[i + 1] : '';
    const afterNext = i + 2 < len ? text[i + 2] : '';

    // Check for Nukta combined consonant (e.g. क + ़ = क़)
    if (nextChar === NUKTA) {
      const combined = char + NUKTA;
      const baseRom = CONSONANTS[combined] || CONSONANTS[char] || char;

      if (afterNext === VIRAMA) {
        result += baseRom;
        i += 2;
      } else if (afterNext in MATRAS) {
        result += baseRom + MATRAS[afterNext];
        i += 2;
      } else if (i + 2 === len || text[i + 2] === ' ' || /[\s\p{P}]/u.test(text[i + 2])) {
        // Word ending schwa deletion (Hindi phonology: last consonant has silent 'a')
        result += baseRom;
        i += 1;
      } else {
        result += baseRom + 'a';
        i += 1;
      }
      continue;
    }

    // Direct consonant
    if (char in CONSONANTS) {
      const baseRom = CONSONANTS[char];

      if (nextChar === VIRAMA) {
        // Halant suppresses inherent 'a'
        result += baseRom;
        i += 1; // skip virama
      } else if (nextChar in MATRAS) {
        // Matra replaces inherent 'a'
        result += baseRom + MATRAS[nextChar];
        i += 1; // skip matra
      } else if (i + 1 === len || nextChar === ' ' || /[\s\p{P}]/u.test(nextChar)) {
        // Word ending schwa deletion (e.g. रात -> raat, not raata)
        result += baseRom;
      } else {
        result += baseRom + 'a';
      }
      continue;
    }

    // Independent Vowel
    if (char in VOWELS) {
      result += VOWELS[char];
      continue;
    }

    // Matra without consonant (unusual, but handle)
    if (char in MATRAS) {
      result += MATRAS[char];
      continue;
    }

    // Modifiers (Anusvara, Candrabindu, Visarga)
    if (char in MODIFIERS) {
      result += MODIFIERS[char];
      continue;
    }

    // Skip naked virama or nukta if encountered separately
    if (char === VIRAMA || char === NUKTA) {
      continue;
    }

    // Punctuation, whitespace, or other characters pass through
    result += char;
  }

  // Capitalize first letter of lines
  return result
    .replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, p1, p2) => p1 + p2.toUpperCase())
    .trim();
}
