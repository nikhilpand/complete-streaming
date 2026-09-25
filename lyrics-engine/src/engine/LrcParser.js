/**
 * LrcParser.js - Universal Synchronized Lyrics & Syllable Timing Parser
 * Parses Standard LRC, Syllable ELRC, Musixmatch Richsync, and Plain text.
 */

export class LrcParser {
  static parse(rawContent) {
    if (!rawContent) return { lines: [], isSynced: false, hasSyllables: false };

    if (typeof rawContent === 'object' && Array.isArray(rawContent)) {
      return this.parseRichsyncArray(rawContent);
    }

    if (typeof rawContent === 'string') {
      const trimmed = rawContent.trim();
      if (trimmed.startsWith('[') && trimmed.includes('"ts"') && trimmed.includes('"l"')) {
        try {
          const parsedJson = JSON.parse(trimmed);
          return this.parseRichsyncArray(parsedJson);
        } catch (_) {}
      }

      if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(trimmed)) {
        return this.parseLrc(trimmed);
      }

      return this.parsePlain(trimmed);
    }

    return { lines: [], isSynced: false, hasSyllables: false };
  }

  static parseLrc(lrcText) {
    const rawLines = lrcText.split(/\r?\n/);
    const parsedLines = [];
    let hasSyllables = false;

    for (let rawLine of rawLines) {
      rawLine = rawLine.trim();
      if (!rawLine || /^\[(ti|ar|al|au|by|offset|length|re|ve):/i.test(rawLine)) continue;

      const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
      const timestamps = [];
      let match;
      let lastIndex = 0;

      while ((match = timeTagRegex.exec(rawLine)) !== null) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        let millis = 0;
        if (match[3]) {
          const raw = match[3];
          millis = raw.length === 1 ? parseInt(raw, 10) * 100 : (raw.length === 2 ? parseInt(raw, 10) * 10 : parseInt(raw.slice(0, 3), 10));
        }
        timestamps.push(mins * 60000 + secs * 1000 + millis);
        lastIndex = timeTagRegex.lastIndex;
      }

      if (timestamps.length === 0) continue;

      let content = rawLine.slice(lastIndex).trim();

      // Check for enhanced word timestamps: <00:12.34> word <00:12.80> next
      let words = null;
      if (/<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/.test(content)) {
        words = this.parseEnhancedWords(content);
        if (words && words.length > 0) {
          hasSyllables = true;
          content = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        }
      }

      for (const time of timestamps) {
        parsedLines.push({
          time,
          endTime: 0,
          text: content,
          words: words ? JSON.parse(JSON.stringify(words)) : null
        });
      }
    }

    parsedLines.sort((a, b) => a.time - b.time);

    for (let i = 0; i < parsedLines.length; i++) {
      const current = parsedLines[i];
      const next = parsedLines[i + 1];

      current.endTime = next ? Math.min(next.time, current.time + 7000) : current.time + 4000;

      // Synthesize proportional syllable word timings if missing
      if (!current.words && current.text) {
        current.words = this.synthesizeWordTimings(current.text, current.time, current.endTime);
      }
    }

    return { lines: parsedLines, isSynced: true, hasSyllables: true };
  }

  static parseEnhancedWords(content) {
    const wordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>\s*([^<]+)/g;
    const words = [];
    let match;

    while ((match = wordRegex.exec(content)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      let millis = 0;
      if (match[3]) {
        const raw = match[3];
        millis = raw.length === 1 ? parseInt(raw, 10) * 100 : (raw.length === 2 ? parseInt(raw, 10) * 10 : parseInt(raw.slice(0, 3), 10));
      }
      const startTime = mins * 60000 + secs * 1000 + millis;
      const text = match[4].trim();
      if (text) words.push({ text, startTime, endTime: 0 });
    }

    for (let i = 0; i < words.length; i++) {
      words[i].endTime = i < words.length - 1 ? words[i + 1].startTime : words[i].startTime + 600;
    }

    return words;
  }

  static synthesizeWordTimings(lineText, startTime, endTime) {
    const rawWords = lineText.trim().split(/\s+/);
    if (!rawWords.length || !rawWords[0]) return [];

    const totalDuration = Math.max(600, endTime - startTime);
    const totalChars = rawWords.reduce((sum, w) => sum + Math.max(1, w.length), 0);

    let cursor = startTime;
    const words = [];

    for (const wordStr of rawWords) {
      const charWeight = Math.max(1, wordStr.length) / totalChars;
      const wordDuration = Math.round(totalDuration * charWeight);

      words.push({
        text: wordStr,
        startTime: cursor,
        endTime: cursor + wordDuration
      });

      cursor += wordDuration;
    }

    return words;
  }

  static parseRichsyncArray(richsyncArray) {
    const lines = [];

    for (const item of richsyncArray) {
      const lineStartMs = Math.round((item.ts || 0) * 1000);
      const lineEndMs = Math.round((item.te || (item.ts + 4)) * 1000);
      const words = [];
      let fullText = '';

      if (Array.isArray(item.l)) {
        for (let i = 0; i < item.l.length; i++) {
          const w = item.l[i];
          const wordText = w.c || '';
          const wordStartMs = lineStartMs + Math.round((w.o || 0) * 1000);

          let wordEndMs = lineEndMs;
          if (i < item.l.length - 1 && item.l[i + 1]?.o !== undefined) {
            wordEndMs = lineStartMs + Math.round(item.l[i + 1].o * 1000);
          }

          words.push({ text: wordText, startTime: wordStartMs, endTime: wordEndMs });
          fullText += wordText + ' ';
        }
      }

      lines.push({
        time: lineStartMs,
        endTime: lineEndMs,
        text: fullText.trim(),
        words: words.length > 0 ? words : null
      });
    }

    return { lines, isSynced: true, hasSyllables: true };
  }

  static parsePlain(plainText) {
    const rawLines = plainText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lines = rawLines.map((text, idx) => ({
      time: idx * 3000,
      endTime: (idx + 1) * 3000,
      text,
      words: null
    }));

    return { lines, isSynced: false, hasSyllables: false };
  }
}
