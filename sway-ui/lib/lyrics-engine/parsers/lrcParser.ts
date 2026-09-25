/**
 * lrcParser.ts
 * Strict LRC parser conforming to Section 15 specifications
 */

import { LyricsLine } from '../types';

export function parseStrictLRC(lrcText: string, trackDurationMs: number = 0): LyricsLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const rawLines = lrcText.split(/\r?\n/);
  const tempLines: Array<{ startMs: number; text: string; isInstrumental: boolean }> = [];

  const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (let rawLine of rawLines) {
    rawLine = rawLine.trim();
    if (!rawLine) continue;

    // Skip metadata headers: [ti:...], [ar:...], [al:...], [by:...], [offset:...]
    if (/^\[(ti|ar|al|au|by|offset|length|re|ve):/i.test(rawLine)) {
      continue;
    }

    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    timeTagRegex.lastIndex = 0;
    while ((match = timeTagRegex.exec(rawLine)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      let millis = 0;
      if (match[3]) {
        const rawMs = match[3];
        millis = rawMs.length === 1 ? parseInt(rawMs, 10) * 100 : (rawMs.length === 2 ? parseInt(rawMs, 10) * 10 : parseInt(rawMs.slice(0, 3), 10));
      }
      timestamps.push((mins * 60 + secs) * 1000 + millis);
      lastIndex = timeTagRegex.lastIndex;
    }

    if (timestamps.length === 0) continue;

    const content = rawLine.slice(lastIndex).trim();
    const isInstrumental =
      !content ||
      content === '♪' ||
      content.includes('♪') ||
      /^(?:\[|\()?instrumental(?:\]|\))?$/i.test(content);

    for (const startMs of timestamps) {
      tempLines.push({
        startMs,
        text: content,
        isInstrumental,
      });
    }
  }

  // Sort monotonically by timestamp with stable ordering
  tempLines.sort((a, b) => a.startMs - b.startMs);

  const result: LyricsLine[] = [];
  const count = tempLines.length;

  for (let i = 0; i < count; i++) {
    const cur = tempLines[i];
    const next = tempLines[i + 1];

    let endMs: number;
    if (next) {
      endMs = Math.max(cur.startMs, next.startMs);
    } else {
      const fallbackEnd = cur.startMs + 5000;
      endMs = trackDurationMs > cur.startMs ? Math.min(trackDurationMs, fallbackEnd) : fallbackEnd;
    }

    // Section 14: Never fabricate word karaoke for standard LRC!
    // Words array is empty for line-synced lyrics unless real word timing is provided.
    result.push({
      id: i,
      startMs: cur.startMs,
      endMs,
      original: cur.text,
      words: [], // Real word sync only! Never fake word timings.
      isInstrumental: cur.isInstrumental,
    });
  }

  return result;
}
