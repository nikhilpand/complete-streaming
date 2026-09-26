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
      const sText = decodeXmlEntities(sMatch[2].replace(/<[^>]+>/g, '')).trim();

      const sBeginStr = extractAttribute(sAttrs, 'begin');
      const sEndStr = extractAttribute(sAttrs, 'end');
      const sDurStr = extractAttribute(sAttrs, 'dur');

      if (sBeginStr && sText) {
        const sBegin = parseTtmlTime(sBeginStr);
        let sEnd = sEndStr ? parseTtmlTime(sEndStr) : 0;
        if (!sEnd && sDurStr) {
          sEnd = sBegin + parseTtmlTime(sDurStr);
        }
        const dur = sEnd > sBegin ? sEnd - sBegin : undefined;

        words.push({
          c: sText + ' ',
          o: Math.max(0, sBegin - pBegin),
          d: dur,
        });
      }
    }

    const cleanLineText = decodeXmlEntities(pBody.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (cleanLineText) {
      plainLines.push(cleanLineText);
    }

    if (words.length > 0) {
      richSync.push({
        ts: pBegin,
        te: pEnd,
        l: words,
      });
    }
  }

  return {
    richSync,
    plainText: plainLines.join('\n'),
  };
}

/**
 * Parses raw RichSync lines into validated canonical LyricsLine objects
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

    const words: LyricsWord[] = [];
    let fullOriginalText = '';
    let lastWordStart = lineStartMs;

    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const wObj = rawWords[wIdx];
      const wordText = String(wObj.c || '');
      const cleanWordText = wordText.trim();
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

      fullOriginalText = fullOriginalText ? `${fullOriginalText} ${cleanWordText}` : cleanWordText;
      words.push({
        text: cleanWordText,
        startMs: Math.max(lineStartMs, startMs),
        endMs: Math.max(startMs + 40, endMs),
        timingType: 'ACOUSTIC_ANCHOR',
        confidence: 0.96,
      });

      lastWordStart = startMs;
    }

    const trimmedText = fullOriginalText.trim();
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
