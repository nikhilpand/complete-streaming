/**
 * richsyncParser.ts
 * Structured Parser & Normalizer for TTML and Genuine Word/Syllable RichSync Timings
 */

import { RichSyncLine, LyricsLine, LyricsWord } from '../types';
import { validateWordSyncStructure } from '../validator';

export interface RichSyncParseResult {
  lines: LyricsLine[];
  isWordSyncValid: boolean;
  timingConfidence: number;
}

export function parseTtmlTime(str: string): number {
  if (!str) return 0;
  const clean = str.trim().replace(/s$/i, '');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(clean) || 0;
}

function decodeXmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractAttribute(attrStr: string, attrName: string): string | null {
  // Matches attrName="value" or attrName='value' ignoring namespaces like ttm:begin or begin
  const re = new RegExp(`(?:\\b[a-zA-Z0-9_-]+:)?${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = re.exec(attrStr);
  return m ? m[1] : null;
}

/**
 * Structured TTML/XML parser that normalizes line spans and word spans
 * regardless of namespace, attribute order, or whitespace variations.
 */
export function parseTtmlToRichSync(ttml: string): { richSync: RichSyncLine[]; plainText: string } {
  if (!ttml || typeof ttml !== 'string') {
    return { richSync: [], plainText: '' };
  }

  const cleanXml = ttml.replace(/<!--[\s\S]*?-->/g, '');
  const richSync: RichSyncLine[] = [];
  const plainLines: string[] = [];

  // Match all <p ...>...</p> tags (with or without namespace prefixes like <tt:p>)
  const pTagRegex = /<(?:[a-zA-Z0-9_-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pTagRegex.exec(cleanXml)) !== null) {
    const pAttrs = pMatch[1];
    const pBody = pMatch[2];

    const beginStr = extractAttribute(pAttrs, 'begin');
    const endStr = extractAttribute(pAttrs, 'end');
    const durStr = extractAttribute(pAttrs, 'dur');

    if (!beginStr) continue;

    const pBegin = parseTtmlTime(beginStr);
    let pEnd = endStr ? parseTtmlTime(endStr) : 0;
    if (!pEnd && durStr) {
      pEnd = pBegin + parseTtmlTime(durStr);
    }
    if (pEnd < pBegin) {
      pEnd = pBegin + 4.0;
    }

    // Extract word spans within paragraph
    const spanTagRegex = /<(?:[a-zA-Z0-9_-]+:)?span\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?span>/gi;
    let sMatch: RegExpExecArray | null;
    const words: Array<{ c: string; o: number; d?: number }> = [];

    while ((sMatch = spanTagRegex.exec(pBody)) !== null) {
      const sAttrs = sMatch[1];
      const sText = decodeXmlEntities(sMatch[2].replace(/<[^>]+>/g, ''));

      const sBeginStr = extractAttribute(sAttrs, 'begin');
      const sEndStr = extractAttribute(sAttrs, 'end');
      const sDurStr = extractAttribute(sAttrs, 'dur');

      if (sBeginStr && sText.trim()) {
        const sBegin = parseTtmlTime(sBeginStr);
        let sEnd = sEndStr ? parseTtmlTime(sEndStr) : 0;
        if (!sEnd && sDurStr) {
          sEnd = sBegin + parseTtmlTime(sDurStr);
        }
        const dur = sEnd > sBegin ? sEnd - sBegin : undefined;

        words.push({
          c: sText,
          o: Math.max(0, sBegin - pBegin),
          d: dur,
        });
      }
    }

    const hasSpanWhitespace = words.some((w) => /\s/.test(w.c));
    const cleanLineText = (words.length > 0 && hasSpanWhitespace)
      ? words.map((w) => w.c).join('').replace(/\s+/g, ' ').trim()
      : decodeXmlEntities(pBody.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (cleanLineText) {
      plainLines.push(cleanLineText);
    }

    if (words.length > 0) {
      richSync.push({
        ts: pBegin,
        te: pEnd,
        text: cleanLineText,
        l: words,
      });
    }
  }

  return {
    richSync,
    plainText: plainLines.join('\n'),
  };
}

const normAlphaNum = (s: string) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function alignSyllablesToExpectedWords(
  expectedLineText: string,
  rawWords: Array<{ c?: string; o?: number; d?: number }>,
  lineStartMs: number,
  lineEndMs: number
): LyricsWord[] | null {
  const expectedWords = expectedLineText.trim().split(/\s+/).filter(Boolean);
  if (expectedWords.length === 0 || rawWords.length === 0) return null;

  const validTokens = rawWords.filter((w) => w && String(w.c || '').trim().length > 0);
  if (validTokens.length === 0) return null;

  if (validTokens.length === expectedWords.length) {
    const tokensNorm = normAlphaNum(validTokens.map((w) => w.c).join(''));
    const expNorm = normAlphaNum(expectedWords.join(''));
    if (Math.abs(tokensNorm.length - expNorm.length) <= 3) {
      return validTokens.map((wObj, idx) => {
        const offsetMs = Math.round(Number(wObj.o || 0) * 1000);
        const startMs = lineStartMs + offsetMs;
        const endMs = typeof wObj.d === 'number' && wObj.d > 0
          ? startMs + Math.round(wObj.d * 1000)
          : Math.min(lineEndMs, startMs + 1000);
        return {
          text: expectedWords[idx],
          startMs: Math.max(lineStartMs, startMs),
          endMs: Math.max(startMs + 40, endMs),
          timingType: 'ACOUSTIC_ANCHOR',
          confidence: 0.96,
        };
      });
    }
  }

  const fullTokensNorm = normAlphaNum(validTokens.map((w) => w.c).join(''));
  const fullExpectedNorm = normAlphaNum(expectedWords.join(''));

  if (Math.abs(fullTokensNorm.length - fullExpectedNorm.length) > 3) {
    return null;
  }

  const resultWords: LyricsWord[] = [];
  let tokenIdx = 0;

  for (let eIdx = 0; eIdx < expectedWords.length; eIdx++) {
    const expWord = expectedWords[eIdx];
    const targetNorm = normAlphaNum(expWord);
    let curNorm = '';
    let curStartMs = -1;
    let curEndMs = -1;

    while (tokenIdx < validTokens.length) {
      const wObj = validTokens[tokenIdx];
      tokenIdx++;
      const rawText = String(wObj.c || '');

      const offsetMs = Math.round(Number(wObj.o || 0) * 1000);
      const tokenStartMs = lineStartMs + offsetMs;
      const nextWord = validTokens[tokenIdx];
      const nextOffsetMs = nextWord ? Math.round(Number(nextWord.o || 0) * 1000) : (lineEndMs - lineStartMs);
      const tokenEndMs = typeof wObj.d === 'number' && wObj.d > 0
        ? tokenStartMs + Math.round(wObj.d * 1000)
        : Math.min(lineEndMs, Math.max(tokenStartMs + 40, lineStartMs + nextOffsetMs));

      if (curStartMs < 0) curStartMs = tokenStartMs;
      curEndMs = Math.max(curEndMs, tokenEndMs);
      curNorm += normAlphaNum(rawText);

      if (curNorm.length >= targetNorm.length && (eIdx < expectedWords.length - 1 || tokenIdx >= validTokens.length)) {
        break;
      }
    }

    if (curStartMs >= 0) {
      resultWords.push({
        text: expWord,
        startMs: Math.max(lineStartMs, curStartMs),
        endMs: Math.max(curStartMs + 40, curEndMs),
        timingType: 'ACOUSTIC_ANCHOR',
        confidence: 0.96,
      });
    }
  }

  return resultWords.length === expectedWords.length ? resultWords : null;
}

/**
 * Parses raw RichSync lines into validated canonical LyricsLine objects
 * with whitespace-aware syllable reconstruction (eliminating gaps inside words).
 */
export function parseRichSync(richSync: RichSyncLine[]): RichSyncParseResult {
  if (!Array.isArray(richSync) || richSync.length === 0) {
    return { lines: [], isWordSyncValid: false, timingConfidence: 0.0 };
  }

  const lines: LyricsLine[] = [];

  for (let lIdx = 0; lIdx < richSync.length; lIdx++) {
    const rawLine = richSync[lIdx];
    const lineStartMs = Math.round(Number(rawLine.ts || 0) * 1000);
    const lineEndMs = Math.round(Number(rawLine.te || (rawLine.ts + 4)) * 1000);
    const rawWords = Array.isArray(rawLine.l) ? rawLine.l : [];

    let words: LyricsWord[] = [];

    // Attempt direct syllable-to-word alignment if authoritative line text is available
    if (rawLine.text && rawLine.text.trim()) {
      const aligned = alignSyllablesToExpectedWords(rawLine.text, rawWords, lineStartMs, lineEndMs);
      if (aligned && aligned.length > 0) {
        words = aligned;
      }
    }

    if (words.length === 0) {
      const hasExplicitWhitespace = rawWords.some((w) => /\s/.test(String(w.c || '')));

      if (hasExplicitWhitespace) {
        // Reconstruct whole words from syllables using whitespace boundaries (Apple Music TTML, BiniLyrics, Musixmatch)
        let curWordText = '';
        let curStartMs = -1;
        let curEndMs = -1;

        const commitCurrentWord = () => {
          const clean = curWordText.trim();
          if (clean && curStartMs >= 0) {
            words.push({
              text: clean,
              startMs: Math.max(lineStartMs, curStartMs),
              endMs: Math.max(curStartMs + 40, curEndMs > curStartMs ? curEndMs : curStartMs + 300),
              timingType: 'ACOUSTIC_ANCHOR',
              confidence: 0.96,
            });
          }
          curWordText = '';
          curStartMs = -1;
          curEndMs = -1;
        };

        for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
          const wObj = rawWords[wIdx];
          const rawText = String(wObj.c || '');
          if (!rawText) continue;

          // If this token is pure whitespace (e.g. { c: " " } in Musixmatch), it marks word boundary
          if (/^\s+$/.test(rawText)) {
            commitCurrentWord();
            continue;
          }

          const offsetMs = Math.round(Number(wObj.o || 0) * 1000);
          const tokenStartMs = lineStartMs + offsetMs;

          let tokenEndMs: number;
          if (typeof wObj.d === 'number' && wObj.d > 0) {
            tokenEndMs = tokenStartMs + Math.round(wObj.d * 1000);
          } else {
            const nextWord = rawWords[wIdx + 1];
            const nextOffsetMs = nextWord ? Math.round(Number(nextWord.o || 0) * 1000) : (lineEndMs - lineStartMs);
            const naturalCap = tokenStartMs + 1800;
            tokenEndMs = Math.min(lineEndMs, Math.max(tokenStartMs + 40, lineStartMs + nextOffsetMs));
          }

          if (curStartMs < 0) curStartMs = tokenStartMs;
          curEndMs = Math.max(curEndMs, tokenEndMs);
          curWordText += rawText;

          // If this token ends with whitespace (e.g. "ye " in Apple Music TTML), commit word
          if (/\s+$/.test(rawText)) {
            commitCurrentWord();
          }
        }
        commitCurrentWord();
      } else {
        // Tokens have no whitespace markers: each token is already an individual word
        for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
          const wObj = rawWords[wIdx];
          const cleanWordText = String(wObj.c || '').trim();
          if (!cleanWordText) continue;

          const offsetMs = Math.round(Number(wObj.o || 0) * 1000);
          const startMs = lineStartMs + offsetMs;

          let endMs: number;
          if (typeof wObj.d === 'number' && wObj.d > 0) {
            endMs = startMs + Math.round(wObj.d * 1000);
          } else {
            const nextWord = rawWords[wIdx + 1];
            const nextOffsetMs = nextWord ? Math.round(Number(nextWord.o || 0) * 1000) : (lineEndMs - lineStartMs);
            const naturalCap = startMs + 1800;
            endMs = Math.min(lineEndMs, Math.min(naturalCap, lineStartMs + nextOffsetMs));
          }

          words.push({
            text: cleanWordText,
            startMs: Math.max(lineStartMs, startMs),
            endMs: Math.max(startMs + 40, endMs),
            timingType: 'ACOUSTIC_ANCHOR',
            confidence: 0.96,
          });
        }
      }
    }

    // Prefer authoritative line text if supplied on rawLine (e.g. from BiniLyrics or TTML)
    const lineText = (rawLine.text && rawLine.text.trim()) || words.map((w) => w.text).join(' ');
    const trimmedText = lineText.trim();

    lines.push({
      id: lIdx,
      startMs: lineStartMs,
      endMs: Math.max(lineStartMs, lineEndMs),
      original: trimmedText,
      words,
      isInstrumental: trimmedText.length === 0 || trimmedText === '♪',
    });
  }

  const validation = validateWordSyncStructure(lines);

  return {
    lines,
    isWordSyncValid: validation.isStructurallyValid && validation.timingConfidence >= 0.70,
    timingConfidence: validation.timingConfidence,
  };
}
