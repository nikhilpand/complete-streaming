import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRichSync, parseTtmlToRichSync } from '../lib/lyrics-engine/parsers/richsyncParser';
import type { RichSyncLine } from '../lib/lyrics-engine/types';

describe('RichSync Syllable Reconstruction & Zero-Word-Gap Parser', () => {
  test('reconstructs multi-syllable Punjabi words without gaps', () => {
    // "Soniye barf vangu thare gabru"
    // Syllables provided with whitespace on terminal syllable of each word
    const richSyncInput: RichSyncLine[] = [
      {
        ts: 10.0,
        te: 14.0,
        text: 'Soniye barf vangu thare gabru',
        l: [
          { c: 'So', o: 0.0, d: 0.2 },
          { c: 'ni', o: 0.2, d: 0.2 },
          { c: 'ye ', o: 0.4, d: 0.3 },
          { c: 'bar', o: 0.8, d: 0.25 },
          { c: 'f ', o: 1.05, d: 0.2 },
          { c: 'van', o: 1.4, d: 0.2 },
          { c: 'gu ', o: 1.6, d: 0.3 },
          { c: 'tha', o: 2.0, d: 0.2 },
          { c: 're ', o: 2.2, d: 0.25 },
          { c: 'gab', o: 2.6, d: 0.25 },
          { c: 'ru', o: 2.85, d: 0.35 },
        ],
      },
    ];

    const result = parseRichSync(richSyncInput);
    assert.equal(result.lines.length, 1);

    const line = result.lines[0];
    assert.equal(line.original, 'Soniye barf vangu thare gabru');
    assert.equal(line.words.length, 5);

    // Verify exact reconstructed words without internal gaps
    assert.equal(line.words[0].text, 'Soniye');
    assert.equal(line.words[1].text, 'barf');
    assert.equal(line.words[2].text, 'vangu');
    assert.equal(line.words[3].text, 'thare');
    assert.equal(line.words[4].text, 'gabru');

    // Verify timings: start of first syllable, end of last syllable
    // "Soniye": start = 10.0s (10000ms), end = 10.0s + 0.4s + 0.3s = 10.7s (10700ms)
    assert.equal(line.words[0].startMs, 10000);
    assert.equal(line.words[0].endMs, 10700);

    // "barf": start = 10.8s (10800ms), end = 10.0s + 1.05s + 0.2s = 11.25s (11250ms)
    assert.equal(line.words[1].startMs, 10800);
    assert.equal(line.words[1].endMs, 11250);
  });

  test('reconstructs English words from Apple Music / BiniLyrics syllabus', () => {
    // "Oh, I'm gon' take your breath away"
    // "a" + "way" -> "away"
    const richSyncInput: RichSyncLine[] = [
      {
        ts: 0.48,
        te: 4.978,
        text: "Oh, I'm gon' take your breath away",
        l: [
          { c: 'Oh, ', o: 0.0, d: 0.684 },
          { c: "I'm ", o: 0.684, d: 0.201 },
          { c: "gon' ", o: 0.885, d: 0.520 },
          { c: 'take ', o: 1.405, d: 0.554 },
          { c: 'your ', o: 1.959, d: 0.701 },
          { c: 'breath ', o: 2.660, d: 0.919 },
          { c: 'a', o: 3.579, d: 0.413 },
          { c: 'way', o: 3.992, d: 0.506 },
        ],
      },
    ];

    const result = parseRichSync(richSyncInput);
    assert.equal(result.lines.length, 1);

    const words = result.lines[0].words;
    assert.equal(words.length, 7);
    assert.equal(words.map((w) => w.text).join(' '), "Oh, I'm gon' take your breath away");
    assert.equal(words[6].text, 'away');
  });

  test('handles standalone single-word lines with syllables', () => {
    // "Baby" -> "Ba" (no space), "by" (end of line)
    const richSyncInput: RichSyncLine[] = [
      {
        ts: 16.307,
        te: 16.920,
        text: 'Baby',
        l: [
          { c: 'Ba', o: 0.0, d: 0.239 },
          { c: 'by', o: 0.239, d: 0.374 },
        ],
      },
    ];

    const result = parseRichSync(richSyncInput);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].words.length, 1);
    assert.equal(result.lines[0].words[0].text, 'Baby');
    assert.equal(result.lines[0].original, 'Baby');
  });

  test('handles Musixmatch style pure whitespace tokens { c: " " }', () => {
    const richSyncInput: RichSyncLine[] = [
      {
        ts: 5.0,
        te: 8.0,
        l: [
          { c: 'Hello', o: 0.0, d: 0.5 },
          { c: ' ', o: 0.5, d: 0.1 },
          { c: 'World', o: 0.6, d: 0.6 },
        ],
      },
    ];

    const result = parseRichSync(richSyncInput);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].words.length, 2);
    assert.equal(result.lines[0].words[0].text, 'Hello');
    assert.equal(result.lines[0].words[1].text, 'World');
    assert.equal(result.lines[0].original, 'Hello World');
  });

  test('parseTtmlToRichSync correctly decodes XML spans with whitespace', () => {
    const ttmlSample = `
      <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
        <body>
          <div>
            <p begin="00:00:05.000" end="00:00:08.500">
              <span begin="00:00:05.000" end="00:00:05.300">Te</span>
              <span begin="00:00:05.300" end="00:00:05.600">ra </span>
              <span begin="00:00:05.600" end="00:00:06.000">vi </span>
              <span begin="00:00:06.000" end="00:00:06.500">dil </span>
              <span begin="00:00:06.500" end="00:00:07.000">jaan</span>
              <span begin="00:00:07.000" end="00:00:07.500">da</span>
            </p>
          </div>
        </body>
      </tt>
    `;

    const parsed = parseTtmlToRichSync(ttmlSample);
    assert.equal(parsed.richSync.length, 1);

    const richSyncLine = parsed.richSync[0];
    assert.equal(richSyncLine.ts, 5.0);
    assert.equal(richSyncLine.te, 8.5);

    const result = parseRichSync(parsed.richSync);
    assert.equal(result.lines.length, 1);
    const words = result.lines[0].words;

    // "Te" + "ra " -> "Tera"
    // "vi " -> "vi"
    // "dil " -> "dil"
    // "jaan" + "da" -> "jaanda"
    assert.equal(words.length, 4);
    assert.equal(words[0].text, 'Tera');
    assert.equal(words[1].text, 'vi');
    assert.equal(words[2].text, 'dil');
    assert.equal(words[3].text, 'jaanda');
    assert.equal(result.lines[0].original, 'Tera vi dil jaanda');
  });
});
