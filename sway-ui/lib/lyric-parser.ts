/**
 * lyric-parser.ts - High-Performance Synchronized Lyrics & Syllable Timing Engine
 */

export interface ParsedWord {
  text: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

export interface ParsedLyricLine {
  time: number;      // in seconds
  endTime: number;   // in seconds
  text: string;
  romanized?: string;
  words: ParsedWord[];
  isInstrumental?: boolean;
}

/**
 * Parses raw LRC string into structured, timestamped lines and word-by-word karaoke units.
 * Supports:
 * - Standard LRC line timestamps [mm:ss.xx]
 * - Enhanced syllable timestamps <mm:ss.xx>
 * - Instrumental sections and markers
 * - Proportional syllable synthesis for standard line-synced lyrics
 */
export function parseLRC(lrcText: string): ParsedLyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const rawLines = lrcText.split(/\r?\n/);
  const parsedLines: ParsedLyricLine[] = [];

  for (let rawLine of rawLines) {
    rawLine = rawLine.trim();
    if (!rawLine || /^\[(ti|ar|al|au|by|offset|length|re|ve):/i.test(rawLine)) {
      continue;
    }

    const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = timeTagRegex.exec(rawLine)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      let millis = 0;
      if (match[3]) {
        const raw = match[3];
        millis = raw.length === 1 ? parseInt(raw, 10) * 100 : (raw.length === 2 ? parseInt(raw, 10) * 10 : parseInt(raw.slice(0, 3), 10));
      }
      timestamps.push(mins * 60 + secs + millis / 1000);
      lastIndex = timeTagRegex.lastIndex;
    }

    if (timestamps.length === 0) continue;

    let content = rawLine.slice(lastIndex).trim();
    const isInstrumental =
      !content ||
      content === '♪' ||
      content.includes('♪') ||
      /^(?:\[|\()?instrumental(?:\]|\))?$/i.test(content);

    // Parse enhanced word timestamps if available: <00:12.34> word <00:12.80> next
    let words: ParsedWord[] | null = null;
    if (/<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/.test(content)) {
      words = parseEnhancedWords(content);
      content = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    for (const time of timestamps) {
      parsedLines.push({
        time,
        endTime: 0,
        text: content,
        words: words ? JSON.parse(JSON.stringify(words)) : [],
        isInstrumental,
      });
    }
  }

  parsedLines.sort((a, b) => a.time - b.time);

  // Calculate line end times. Missing word timing strictly produces words: [] (LINE != WORD)
  for (let i = 0; i < parsedLines.length; i++) {
    const current = parsedLines[i];
    const next = parsedLines[i + 1];

    current.endTime = next ? Math.min(next.time, current.time + 8) : current.time + 4;

    // Standard line sync has NO word timings. Real word sync only.
    if (!current.words) {
      current.words = [];
    }
  }

  return parsedLines;
}

function parseEnhancedWords(content: string): ParsedWord[] {
  const wordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>\s*([^<]+)/g;
  const words: ParsedWord[] = [];
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(content)) !== null) {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    let millis = 0;
    if (match[3]) {
      const raw = match[3];
      millis = raw.length === 1 ? parseInt(raw, 10) * 100 : (raw.length === 2 ? parseInt(raw, 10) * 10 : parseInt(raw.slice(0, 3), 10));
    }
    const startTime = mins * 60 + secs + millis / 1000;
    const text = match[4].trim();
    if (text) {
      words.push({ text, startTime, endTime: 0 });
    }
  }

  for (let i = 0; i < words.length; i++) {
    words[i].endTime = i < words.length - 1 ? words[i + 1].startTime : words[i].startTime + 0.6;
  }

  return words;
}

export function findActiveIndex(time: number, lines: ParsedLyricLine[]): number {
  if (!lines || lines.length === 0) return -1;
  if (time < lines[0].time) return 0; // Keep first line in focus during song intro

  let low = 0;
  let high = lines.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= time) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}
