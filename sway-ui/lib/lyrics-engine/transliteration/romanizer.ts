/**
 * romanizer.ts
 * Natural Hindi Devanagari to Roman (Hinglish) Transliterator (Section 24 & 25)
 * Combines ISO 15919 baseline with natural song phonetic rules and schwa deletion.
 * ZERO HARDCODED VOCABULARY.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'bh': 'bh', 'भ': 'bh', 'म': 'm',
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

export function romanizeDevanagariWord(word: string): string {
  if (!word) return '';

  let result = '';
  const len = word.length;

  for (let i = 0; i < len; i++) {
    const char = word[i];
    const nextChar = i + 1 < len ? word[i + 1] : '';
    const afterNext = i + 2 < len ? word[i + 2] : '';

    // 1. Nukta consonant
    if (nextChar === NUKTA) {
      const combined = char + NUKTA;
      const baseRom = CONSONANTS[combined] || CONSONANTS[char] || char;

      if (afterNext === VIRAMA) {
        result += baseRom;
        i += 2;
      } else if (afterNext in MATRAS) {
        let matraRom = MATRAS[afterNext];
        if (afterNext === 'ा') {
          const isWordEnd = i + 3 >= len || word[i + 3] === ' ' || /[\s\p{P}]/u.test(word[i + 3]);
          matraRom = isWordEnd && len > 3 ? 'a' : 'aa';
        } else if (afterNext === 'ू') {
          const isWordEnd = i + 3 >= len || word[i + 3] === ' ' || /[\s\p{P}]/u.test(word[i + 3]);
          if (isWordEnd) matraRom = 'u';
        }
        result += baseRom + matraRom;
        i += 2;
      } else if (i + 2 >= len || word[i + 2] === ' ' || /[\s\p{P}]/u.test(word[i + 2])) {
        // Word ending schwa deletion
        result += baseRom;
        i += 1;
      } else {
        result += baseRom + 'a';
        i += 1;
      }
      continue;
    }

    // 2. Direct consonant
    if (char in CONSONANTS) {
      const baseRom = CONSONANTS[char];

      if (nextChar === VIRAMA) {
        // Halant suppresses inherent 'a'
        result += baseRom;
        i += 1; // skip virama
      } else if (nextChar in MATRAS) {
        // Matra replaces inherent 'a'
        let matraRom = MATRAS[nextChar];
        if (nextChar === 'ा') {
          const isWordEnd = i + 2 >= len || word[i + 2] === ' ' || /[\s\p{P}]/u.test(word[i + 2]);
          matraRom = isWordEnd && len > 2 ? 'a' : 'aa';
        } else if (nextChar === 'ू') {
          const isWordEnd = i + 2 >= len || word[i + 2] === ' ' || /[\s\p{P}]/u.test(word[i + 2]);
          if (isWordEnd) matraRom = 'u';
        }
        result += baseRom + matraRom;
        i += 1; // skip matra
      } else if (i + 1 >= len || nextChar === ' ' || /[\s\p{P}]/u.test(nextChar)) {
        // Word ending schwa deletion (e.g. रात -> raat, not raata)
        result += baseRom;
      } else {
        result += baseRom + 'a';
      }
      continue;
    }

    // 3. Independent Vowel
    if (char in VOWELS) {
      result += VOWELS[char];
      continue;
    }

    // 4. Matra without consonant (fallback)
    if (char in MATRAS) {
      result += MATRAS[char];
      continue;
    }

    // 5. Modifiers
    if (char in MODIFIERS) {
      result += MODIFIERS[char];
      continue;
    }

    // Skip virama or nukta if separate
    if (char === VIRAMA || char === NUKTA) {
      continue;
    }

    result += char;
  }

  return result;
}
