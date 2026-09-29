import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  romanizeDevanagariWord,
} from '../lib/lyrics-engine/transliteration/romanizer';
import {
  detectScript,
  isDevanagariScript,
  isNonLatinScript,
} from '../lib/lyrics-engine/transliteration/detector';
import {
  romanizeMixedText,
  enrichLinesWithRomanization,
} from '../lib/lyrics-engine/transliteration/index';
import type { LyricsLine } from '../lib/lyrics-engine/types';

describe('Hindi (Devanagari) Transliteration Engine & Script Detection', () => {
  describe('Unicode Script Detection', () => {
    test('detects Devanagari script accurately', () => {
      assert.equal(detectScript('तू ही मेरी शब है'), 'Devanagari');
      assert.equal(detectScript('दिलबर जाने'), 'Devanagari');
      assert.equal(isDevanagariScript('आँखों'), true);
      assert.equal(isDevanagariScript('Hello'), false);
    });

    test('isNonLatinScript returns true for Devanagari text', () => {
      assert.equal(isNonLatinScript('तू ही मेरी शब है'), true);
      assert.equal(isNonLatinScript('Kesariya'), false);
    });
  });

  describe('Phonetic Transliteration & Schwa Deletion', () => {
    test('drops terminal schwa in standard words', () => {
      assert.equal(romanizeDevanagariWord('रात'), 'raat');
      assert.equal(romanizeDevanagariWord('दिल'), 'dil');
      assert.equal(romanizeDevanagariWord('प्यार'), 'pyaar');
    });

    test('handles independent vowels and dependent matras', () => {
      assert.equal(romanizeDevanagariWord('आना'), 'aana');
      assert.equal(romanizeDevanagariWord('इक'), 'ik');
      assert.equal(romanizeDevanagariWord('मेरी'), 'meree');
    });

    test('handles Nukta consonants and Virama', () => {
      assert.equal(romanizeDevanagariWord('फ़ासले'), 'faasale');
      assert.equal(romanizeDevanagariWord('ज़िंदगी'), 'zindagee');
      assert.equal(romanizeDevanagariWord('शब'), 'shab');
    });
  });

  describe('Real-World Lyrics Verses', () => {
    test('transliterates Hindi verse accurately', () => {
      const line = 'तू ही मेरी शब है सुबह है';
      const romanized = romanizeMixedText(line, true);
      assert.match(romanized, /Tu\s+hee\s+meree\s+shab\s+hai\s+subah\s+hai/i);
    });
  });

  describe('Mixed Script & English Preservation', () => {
    test('preserves Latin tokens verbatim in mixed lyrics', () => {
      const line = 'तेरे साथ Party All Night होगी';
      const romanized = romanizeMixedText(line, true);
      assert.match(romanized, /Party All Night/);
    });
  });

  describe('LyricsLine Dual-Script Enrichment', () => {
    test('enriches synced lines with romanized text', () => {
      const lines: LyricsLine[] = [
        {
          id: 1,
          startMs: 4000,
          endMs: 8000,
          original: 'तू ही मेरी शब है',
          words: [],
        },
      ];

      const enriched = enrichLinesWithRomanization(lines);
      assert.equal(enriched.hasRomanizedContent, true);
      assert.match(enriched.lines[0].romanized!, /Tu hee meree shab hai/i);
    });
  });
});
