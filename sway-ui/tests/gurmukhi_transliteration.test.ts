import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  romanizeGurmukhiWord,
  romanizeGurmukhiText,
} from '../lib/lyrics-engine/transliteration/gurmukhiRomanizer';
import {
  detectScript,
  isGurmukhiScript,
  isNonLatinScript,
} from '../lib/lyrics-engine/transliteration/detector';
import {
  romanizeMixedText,
  enrichLinesWithRomanization,
} from '../lib/lyrics-engine/transliteration/index';
import type { LyricsLine } from '../lib/lyrics-engine/types';

describe('Gurmukhi (Punjabi) Transliteration Engine & Script Detection', () => {
  describe('Unicode Script Detection', () => {
    test('detects Gurmukhi script correctly', () => {
      assert.equal(detectScript('੨੬ ਸਾਲ ਦੀ ਕੰਵਾਰੀ'), 'Gurmukhi');
      assert.equal(detectScript('ਵੱਡੇ-ਵੱਡੇ ਵੈਲੀ'), 'Gurmukhi');
      assert.equal(isGurmukhiScript('ਕੰਵਾਰੀ'), true);
      assert.equal(isGurmukhiScript('ਪੰਜੇਬਾਂ'), true);
      assert.equal(isGurmukhiScript('hello world'), false);
      assert.equal(isGurmukhiScript('दिलबर जाने'), false);
      assert.equal(isGurmukhiScript('کہانی'), false);
    });

    test('isNonLatinScript returns true for Gurmukhi text', () => {
      assert.equal(isNonLatinScript('੨੬ ਸਾਲ ਦੀ'), true);
      assert.equal(isNonLatinScript('ਪੰਜੇਬਾਂ'), true);
      assert.equal(isNonLatinScript('Shape of You'), false);
    });
  });

  describe('Gurmukhi Digits Mapping', () => {
    test('correctly maps Gurmukhi numerals to Latin digits', () => {
      assert.equal(romanizeGurmukhiWord('੨੬'), '26');
      assert.equal(romanizeGurmukhiWord('੮'), '8');
      assert.equal(romanizeGurmukhiWord('੧੦੦'), '100');
      assert.equal(romanizeGurmukhiWord('੨੦੨੪'), '2024');
    });
  });

  describe('Addak Gemination (Following Consonant Doubling)', () => {
    test('doubles the consonant following Addak (ੱ)', () => {
      assert.equal(romanizeGurmukhiWord('ਵੱਡੇ'), 'vadde');
      assert.equal(romanizeGurmukhiWord('ਦੱਸ'), 'dass');
      assert.equal(romanizeGurmukhiWord('ਇੱਕ'), 'ikk');
      assert.equal(romanizeGurmukhiWord('ਅੱਜ'), 'ajj');
      assert.equal(romanizeGurmukhiWord('ਕੁੱਤਾ'), 'kutta');
    });
  });

  describe('Tippi and Bindi Nasalization', () => {
    test('assimilates to "m" before labials (p, ph, b, bh, m)', () => {
      assert.equal(romanizeGurmukhiWord('ਘੁੰਮੇ'), 'ghumme');
      assert.equal(romanizeGurmukhiWord('ਅੰਬ'), 'amb');
    });

    test('vocalizes to "n" before non-labials or medial consonants', () => {
      assert.equal(romanizeGurmukhiWord('ਕੰਵਾਰੀ'), 'kanwaari');
      assert.equal(romanizeGurmukhiWord('ਪੰਜੇਬਾਂ'), 'panjeban');
      assert.equal(romanizeGurmukhiWord('ਜੇਬਾਂ'), 'jeban');
      assert.equal(romanizeGurmukhiWord('ਮੂੰਹ'), 'munh');
    });

    test('preserves full "aan" in monosyllabic words', () => {
      assert.equal(romanizeGurmukhiWord('ਲਾਂ'), 'laan');
      assert.equal(romanizeGurmukhiWord('ਮਾਂ'), 'maan');
    });
  });

  describe('Glide Insertion and Medial Codas', () => {
    test('inserts "y" glide for Sihari/Bihari before Aa', () => {
      assert.equal(romanizeGurmukhiWord('ਧਿਆਨ'), 'dhyaan');
      assert.equal(romanizeGurmukhiWord('ਮੇਰੀਆਂ'), 'meriyan');
    });

    test('suppresses medial schwa on rhotic and glottal codas', () => {
      assert.equal(romanizeGurmukhiWord('ਕਰਕੇ'), 'karke');
      assert.equal(romanizeGurmukhiWord('ਕੀਹਦਾ'), 'keehda');
    });
  });

  describe('Real-World Lyrics from "8 Parche" (Screenshot Verification)', () => {
    test('accurately romanizes line 1 with digits and punctuation', () => {
      const line = '੨੬ ਸਾਲ ਦੀ-, ਸਾਲ ਦੀ-, ਸਾਲ ਦੀ...';
      const result = romanizeGurmukhiText(line, true);
      assert.equal(result, '26 saal di-, saal di-, saal di...');
    });

    test('accurately romanizes line 2: ੨੬ ਸਾਲ ਦੀ ਕੰਵਾਰੀ ਬੈਠੀ ਤੇਰੇ ਕਰਕੇ', () => {
      const line = '੨੬ ਸਾਲ ਦੀ ਕੰਵਾਰੀ ਬੈਠੀ ਤੇਰੇ ਕਰਕੇ';
      const result = romanizeGurmukhiText(line, true);
      assert.equal(result, '26 saal di kanwaari baithi tere karke');
    });

    test('accurately romanizes line 3: ਵੱਡੇ-ਵੱਡੇ ਵੈਲੀ ਪਾਕੇ ਘੁੰਮੇ ਜੇਬਾਂ \'ਚ', () => {
      const line = 'ਵੱਡੇ-ਵੱਡੇ ਵੈਲੀ ਪਾਕੇ ਘੁੰਮੇ ਜੇਬਾਂ \'ਚ';
      const result = romanizeGurmukhiText(line, true);
      assert.equal(result, "Vadde-vadde vaili paake ghumme jeban 'ch");
    });

    test('accurately romanizes line 4: ਜਾਂਦਾ ਨਾ ਧਿਆਨ ਮੇਰੀਆਂ ਪੰਜੇਬਾਂ \'ਚ', () => {
      const line = 'ਜਾਂਦਾ ਨਾ ਧਿਆਨ ਮੇਰੀਆਂ ਪੰਜੇਬਾਂ \'ਚ';
      const result = romanizeGurmukhiText(line, true);
      assert.equal(result, "Jaanda na dhyaan meriyan panjeban 'ch");
    });

    test('accurately romanizes line 5: ਕੀਹਦਾ-ਕੀਹਦਾ ਐਥੇ ਦੱਸ ਮੂੰਹ ਫ਼ੜ ਲਾਂ?', () => {
      const line = 'ਕੀਹਦਾ-ਕੀਹਦਾ ਐਥੇ ਦੱਸ ਮੂੰਹ ਫ਼ੜ ਲਾਂ?';
      const result = romanizeGurmukhiText(line, true);
      assert.equal(result, 'Keehda-keehda aithe dass munh fad laan?');
    });
  });

  describe('Full Transliteration Pipeline & Mixed Text Integration', () => {
    test('romanizeMixedText processes Gurmukhi tokens while preserving English and symbols', () => {
      const mixed = '੨੬ ਸਾਲ ਦੀ (Remix) feat. Sidhu';
      const result = romanizeMixedText(mixed, true);
      assert.equal(result, '26 saal di (Remix) feat. Sidhu');
    });

    test('enrichLinesWithRomanization attaches romanized text for Gurmukhi lines', () => {
      const lines: LyricsLine[] = [
        {
          id: 1,
          startMs: 12000,
          endMs: 16000,
          original: '੨੬ ਸਾਲ ਦੀ ਕੰਵਾਰੀ ਬੈਠੀ ਤੇਰੇ ਕਰਕੇ',
          words: [
            { startMs: 12000, endMs: 12300, text: '੨੬' },
            { startMs: 12300, endMs: 12500, text: 'ਸਾਲ' },
            { startMs: 12500, endMs: 12800, text: 'ਦੀ' },
            { startMs: 12800, endMs: 13500, text: 'ਕੰਵਾਰੀ' },
          ],
        },
      ];

      const enriched = enrichLinesWithRomanization(lines);
      assert.equal(enriched.hasRomanizedContent, true);
      assert.equal(enriched.lines[0].romanized, '26 saal di kanwaari baithi tere karke');
      assert.equal(enriched.lines[0].words![0].romanized, '26');
      assert.equal(enriched.lines[0].words![1].romanized, 'saal');
      assert.equal(enriched.lines[0].words![2].romanized, 'di');
      assert.equal(enriched.lines[0].words![3].romanized, 'kanwaari');
    });
  });
});
