/**
 * gurmukhiRomanizer.ts
 * Pure Algorithmic Gurmukhi (Punjabi) to Latin/English Script Romanization Engine.
 *
 * Designed with ZERO hardcoded word dictionaries.
 * Fully algorithmic based on Punjabi phonology and Gurmukhi orthography:
 * 1. Gurmukhi Digits (੦-੯ -> 0-9)
 * 2. Independent Vowels (ਅ, ਆ, ਇ, ਈ, ਉ, ਊ, ਏ, ਐ, ਓ, ਔ) and Vowel Bearers (ੳ, ੲ)
 * 3. Matras / Dependent Vowels (ਾ, ਿ, ੀ, ੁ, ੂ, ੇ, ੈ, ੋ, ੌ)
 * 4. Consonant inventory including Nukta variants (ਫ਼, ਜ਼, ਸ਼, ਖ਼, ਗ਼, ਲ਼, ੜ)
 * 5. Addak (ੱ U+0A71): Systematic gemination of the FOLLOWING consonant (e.g. ਵੱਡੇ -> vadde, ਦੱਸ -> dass)
 * 6. Tippi (ੰ U+0A70) & Bindi (ਂ U+0A02): Context-sensitive nasalization
 *    (vocalized as 'm' before labials [ਪ, ਫ, ਬ, ਭ, ਮ], otherwise 'n'/'an')
 * 7. Glide Insertion: Bihari/Sihari before Aa (e.g. ਧਿਆਨ -> dhyaan, ਮੇਰੀਆਂ -> meriyan)
 * 8. Hindustani schwa deletion / preservation rules based on syllable codas
 */

const GURMUKHI_DIGITS: Record<string, string> = {
  '੦': '0', '੧': '1', '੨': '2', '੩': '3', '੪': '4',
  '੫': '5', '੬': '6', '੭': '7', '੮': '8', '੯': '9',
};

const VOWELS: Record<string, string> = {
  'ਅ': 'a',
  'ਆ': 'aa',
  'ਇ': 'i',
  'ਈ': 'ee',
  'ਉ': 'u',
  'ਊ': 'oo',
  'ਏ': 'e',
  'ਐ': 'ai',
  'ਓ': 'o',
  'ਔ': 'au',
};

const MATRAS: Record<string, string> = {
  'ਾ': 'aa',
  'ਿ': 'i',
  'ੀ': 'ee',
  'ੁ': 'u',
  'ੂ': 'oo',
  'ੇ': 'e',
  'ੈ': 'ai',
  'ੋ': 'o',
  'ੌ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'ਕ': 'k', 'ਖ': 'kh', 'ਗ': 'g', 'ਘ': 'gh', 'ਙ': 'ng',
  'ਚ': 'ch', 'ਛ': 'chh', 'ਜ': 'j', 'ਝ': 'jh', 'ਞ': 'ny',
  'ਟ': 't', 'ਠ': 'th', 'ਡ': 'd', 'ਢ': 'dh', 'ਣ': 'n',
  'ਤ': 't', 'ਥ': 'th', 'ਦ': 'd', 'ਧ': 'dh', 'ਨ': 'n',
  'ਪ': 'p', 'ਫ': 'ph', 'ਬ': 'b', 'ਭ': 'bh', 'ਮ': 'm',
  'ਯ': 'y', 'ਰ': 'r', 'ਲ': 'l', 'ਵ': 'v', 'ੜ': 'd',
  'ਸ': 's', 'ਹ': 'h',
  // Precomposed or decomposed Nukta consonants
  'ਸ਼': 'sh', 'ਖ਼': 'kh', 'ਗ਼': 'gh', 'ਜ਼': 'z', 'ਫ਼': 'f', 'ਲ਼': 'l',
};

const NUKTA = '਼'; // U+0A3C
const VIRAMA = '੍'; // U+0A4D (Halant)
const ADDAK = 'ੱ'; // U+0A71 (Gemination of subsequent consonant)
const TIPPI = 'ੰ'; // U+0A70 (Nasal)
const BINDI = 'ਂ'; // U+0A02 (Nasal)

/**
 * Checks if a character is a Gurmukhi consonant
 */
function isConsonant(ch: string): boolean {
  return ch in CONSONANTS;
}

/**
 * Checks if a character is a labial consonant (p, ph, b, bh, m)
 * where nasals assimilate phonetically to 'm'
 */
function isLabial(ch: string): boolean {
  return ch === 'ਪ' || ch === 'ਫ' || ch === 'ਬ' || ch === 'ਭ' || ch === 'ਮ' || ch === 'ਫ਼';
}

/**
 * Algorithmic romanization of a single Gurmukhi word token.
 * Zero hardcoded vocabulary. Pure orthography and phonology.
 */
export function romanizeGurmukhiWord(word: string): string {
  if (!word) return '';

  let res = '';
  const len = word.length;
  let geminateNext = false;

  for (let i = 0; i < len; i++) {
    const char = word[i];
    const next = i + 1 < len ? word[i + 1] : '';

    // 1. Gurmukhi Digits (e.g. ੨੬ -> 26, ੮ -> 8)
    if (char in GURMUKHI_DIGITS) {
      res += GURMUKHI_DIGITS[char];
      continue;
    }

    // 2. Addak (U+0A71): Marks the FOLLOWING consonant to be geminated
    if (char === ADDAK) {
      geminateNext = true;
      continue;
    }

    // 3. Tippi (U+0A70) & Bindi (U+0A02): Nasalization
    if (char === TIPPI || char === BINDI) {
      // Assimilation: if followed by a labial consonant (p, ph, b, bh, m), vocalize as 'm'
      if (isLabial(next)) {
        res += 'm';
      } else {
        res += 'n';
      }
      continue;
    }

    // 4. Vowel bearer handling for decomposed sequences (ੳ, ੲ)
    if (char === 'ੲ' || char === 'ੳ') {
      if (next in MATRAS) {
        // Matra directly attaches to bearer, let next step handle it as vowel
        continue;
      }
    }

    // 5. Nukta combination lookahead (e.g. ਫ + ਼ -> ਫ਼)
    let baseChar = char;
    let skip = 0;
    if (next === NUKTA) {
      const combined = char + NUKTA;
      if (combined in CONSONANTS) {
        baseChar = combined;
        skip = 1;
      }
    }

    // 6. Consonant Handling
    if (baseChar in CONSONANTS) {
      let rom = CONSONANTS[baseChar];

      // Medial 'v' after consonants or nasals sounds as 'w' (e.g. kanwaari)
      if (baseChar === 'ਵ' && i > 0) {
        const prev = word[i - 1];
        if (prev === TIPPI || prev === VIRAMA || isConsonant(prev)) {
          rom = 'w';
        }
      }

      // Apply Addak gemination if triggered by preceding Addak
      if (geminateNext) {
        rom = rom[0] + rom; // e.g. d -> dd, s -> ss, ch -> cch
        geminateNext = false;
      }
      i += skip;

      const postChar = i + 1 < len ? word[i + 1] : '';
      const postNext = i + 2 < len ? word[i + 2] : '';
      const postAfterTwo = i + 3 < len ? word[i + 3] : '';

      // Virama / Halant: suppresses inherent schwa, merges with subsequent consonant
      if (postChar === VIRAMA) {
        res += rom;
        i += 1; // skip virama
        continue;
      }

      // Dependent Vowel (Matra)
      if (postChar in MATRAS) {
        let matraRom = MATRAS[postChar];

        // Glide Insertion: Sihari (ਿ) or Bihari (ੀ) before independent Aa (ਆ)
        // e.g. ਧਿਆਨ -> dhyaan, ਮੇਰੀਆਂ -> meriyan
        if ((postChar === 'ਿ' || postChar === 'ੀ') && postNext === 'ਆ') {
          const afterAa = i + 3 < len ? word[i + 3] : '';
          const hasNasalAfter = afterAa === BINDI || afterAa === TIPPI;
          const glideVowel = hasNasalAfter ? 'ya' : 'yaa';
          res += rom + (postChar === 'ਿ' ? '' : 'i') + glideVowel;
          i += 2; // skip both matra and Aa
          continue;
        }

        // Word-final adjustments:
        // Bihari (ੀ) at word boundary is typically transcribed as 'i' (e.g. ਦੀ -> di, ਬੈਠੀ -> baithi)
        const isWordEnd = i + 2 >= len || postNext === ' ' || /[\s\p{P}]/u.test(postNext);
        const isWordEndAfterNasal =
          (postNext === BINDI || postNext === TIPPI) &&
          (i + 3 >= len || postAfterTwo === ' ' || /[\s\p{P}]/u.test(postAfterTwo));

        if (postChar === 'ੀ' && isWordEnd) {
          matraRom = 'i';
        } else if (postChar === 'ਾ') {
          // Word-final Kanna + Bindi in polysyllabic words produces plural -an (e.g. ਜੇਬਾਂ -> jeban, ਪੰਜੇਬਾਂ -> panjeban)
          // For monosyllabic roots (len <= 3, e.g. ਲਾਂ -> laan, ਮਾਂ -> maan), retain full 'aa' -> -aan
          if (isWordEndAfterNasal) {
            matraRom = len <= 3 ? 'aa' : 'a';
          } else if (isWordEnd) {
            // Word-final Kanna is standardly 'a' (e.g. ਜਾਂਦਾ -> jaanda, ਨਾ -> na, ਕੀਹਦਾ -> keehda)
            matraRom = 'a';
          }
        } else if (postChar === 'ੂ' && (postNext === 'ਹ' || postNext === BINDI || postNext === TIPPI)) {
          // U-vowel before glottal coda or nasal (e.g. ਮੂੰਹ -> munh)
          matraRom = 'u';
        }

        res += rom + matraRom;
        i += 1;
        continue;
      }

      // Consonant followed immediately by Addak (e.g. ਵੱਡੇ: v + Addak -> va + dde)
      if (postChar === ADDAK) {
        res += rom + 'a';
        continue;
      }

      // Consonant followed immediately by Tippi (e.g. ਕੰਵਾਰੀ: k + Tippi -> kan + waari)
      if (postChar === TIPPI) {
        res += rom + 'a';
        continue;
      }

      // Inherent Schwa Deletion / Retention rules:
      // Word-final consonant deletes inherent schwa (e.g. ਸਾਲ -> saal, ਦੱਸ -> dass)
      if (i + 1 >= len || postChar === ' ' || /[\s\p{P}]/u.test(postChar)) {
        res += rom;
      } else {
        // Medial codas: Rhotic (ਰ) or Glottal (ਹ) preceding another consonant suppress schwa
        // e.g. ਕਰਕੇ -> karke (not karake), ਕੀਹਦਾ -> keehda (not keehada)
        if ((baseChar === 'ਰ' || baseChar === 'ਹ') && isConsonant(postChar)) {
          res += rom;
        } else {
          res += rom + 'a';
        }
      }
      continue;
    }

    // 7. Independent Vowel Handling (ਅ, ਆ, ਇ, ਈ, ਉ, ਊ, ਏ, ਐ, ਓ, ਔ)
    if (char in VOWELS) {
      res += VOWELS[char];
      continue;
    }

    // 8. Isolated Matra fallback
    if (char in MATRAS) {
      res += MATRAS[char];
      continue;
    }

    // 9. Passthrough for punctuation, symbols, or unmapped characters
    res += char;
  }

  // Polish formatting artifacts: collapse redundant duplicate vowels
  return res
    .replace(/aaa+/g, 'aa')
    .replace(/eee+/g, 'ee')
    .replace(/ooo+/g, 'oo');
}

/**
 * Romanizes Gurmukhi text line with word tokenization.
 */
export function romanizeGurmukhiText(text: string, capitalizeFirst: boolean = true): string {
  if (!text) return '';

  const tokens = text.split(/([^\p{L}\p{M}\p{N}]+)/u);
  const romanizedTokens = tokens.map((token) => {
    if (/[\u0A00-\u0A7F]/.test(token)) {
      return romanizeGurmukhiWord(token);
    }
    return token;
  });

  const joined = romanizedTokens.join('').replace(/\s{2,}/g, ' ').trim();
  if (capitalizeFirst) {
    return joined.replace(/(^\s*[a-z])/g, (m) => m.toUpperCase());
  }
  return joined;
}
