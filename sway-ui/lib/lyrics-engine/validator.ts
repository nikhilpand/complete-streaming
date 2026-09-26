/**
 * validator.ts
 * Deep Structural & Acoustic Sanity Validation for Lyrics Candidates (Section 11)
 *
 * Distinguishes syntactic/structural validation from timing confidence.
 * Enforces line/word boundary containment, strict monotonicity, overlap limits,
 * token coverage, and timestamp density.
 */

import { LyricsCandidate, LyricsLine, LyricsWord } from './types';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  sanitizedText?: string;
  structuralConfidence?: number;
}

export interface WordSyncValidationResult {
  isStructurallyValid: boolean;
  timingConfidence: number; // 0.0 to 1.0
  containmentRate: number;
  monotonicityRate: number;
  tokenCoverageRate: number;
  overlapViolations: number;
  rejectionReason?: string;
}

const ERROR_PATTERNS = [
  /404\s+not\s+found/i,
  /access\s+denied/i,
  /lyrics\s+not\s+available/i,
  /we\s+do\s+not\s+have\s+the\s+lyrics/i,
  /captcha/i,
  /rate\s+limit\s+exceeded/i,
  /cloudflare/i,
  /unauthorized/i,
  /forbidden/i,
];

export function validateLyricsContent(rawContent: string, isSynced: boolean = false): ValidationResult {
  if (!rawContent || typeof rawContent !== 'string') {
    return { isValid: false, reason: 'Empty lyrics content' };
  }

  const trimmed = rawContent.trim();

  // 1. Minimum character length
  if (trimmed.length < 20) {
    return { isValid: false, reason: `Too short: ${trimmed.length} chars (minimum 20)` };
  }

  // 2. Reject HTML / Script tags
  if (/<(?:html|body|script|style|table|div|head)[\s>]/i.test(trimmed)) {
    return { isValid: false, reason: 'HTML/Script payload detected in lyrics body' };
  }

  // 3. Reject raw JSON / XML payload
  if (trimmed.startsWith('{') || trimmed.startsWith('<?xml') || (trimmed.startsWith('[') && !/^\[\d{1,2}:\d{2}/.test(trimmed))) {
    return { isValid: false, reason: 'JSON or XML payload leakage' };
  }

  // 4. Reject obvious error responses
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(trimmed) && trimmed.length < 300) {
      return { isValid: false, reason: `Error page text detected: ${pattern}` };
    }
  }

  // 5. Line count check
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return { isValid: false, reason: `Insufficient lines: ${lines.length} (minimum 3)` };
  }

  // 6. Check for identical line explosion (spam/malformed repeat > 65% of lines)
  const lineFrequency: Record<string, number> = {};
  for (const line of lines) {
    const cleanLine = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim().toLowerCase();
    if (cleanLine.length > 3) {
      lineFrequency[cleanLine] = (lineFrequency[cleanLine] || 0) + 1;
      if (lineFrequency[cleanLine] > Math.max(10, lines.length * 0.65)) {
        return { isValid: false, reason: `Identical line explosion detected for: "${cleanLine}"` };
      }
    }
  }

  // 7. If synced, validate timestamp monotonicity and bounds
  if (isSynced) {
    const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    let lastTime = -1;
    let validTimestampCount = 0;

    for (const line of lines) {
      timestampRegex.lastIndex = 0;
      const match = timestampRegex.exec(line);
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        const currentSec = mins * 60 + secs + ms / 1000;

        if (currentSec < 0) {
          return { isValid: false, reason: 'Negative timestamp found in synced lyrics' };
        }

        if (lastTime >= 0 && currentSec < lastTime - 1.0) {
          return { isValid: false, reason: `Non-monotonic timestamp jump: ${lastTime}s -> ${currentSec}s` };
        }

        if (currentSec > 7200) {
          return { isValid: false, reason: `Absurd timestamp: ${currentSec}s (> 2 hours)` };
        }

        lastTime = currentSec;
        validTimestampCount++;
      }
    }

    if (validTimestampCount < 3) {
      return { isValid: false, reason: 'Insufficient valid timestamps for synced lyrics' };
    }
  }

  return { isValid: true, sanitizedText: trimmed, structuralConfidence: 0.95 };
}

/**
 * Validates word-level synchronization structure according to strict audio/karaoke rules:
 * - line.startMs <= word.startMs + 100
 * - word.startMs < word.endMs
 * - word.endMs <= line.endMs + 150
 * - word overlap <= 50ms (for transitions)
 * - word duration within [40ms, 6000ms]
 * - token coverage
 */
export function validateWordSyncStructure(lines: LyricsLine[]): WordSyncValidationResult {
  if (!lines || lines.length === 0) {
    return {
      isStructurallyValid: false,
      timingConfidence: 0.0,
      containmentRate: 0.0,
      monotonicityRate: 0.0,
      tokenCoverageRate: 0.0,
      overlapViolations: 0,
      rejectionReason: 'Empty lines array',
    };
  }

  let totalWords = 0;
  let containmentHits = 0;
  let monotonicHits = 0;
  let overlapViolations = 0;
  let totalExpectedTokens = 0;
  let totalMatchedTokens = 0;

  for (const line of lines) {
    if (line.isInstrumental || !line.words || line.words.length === 0) continue;

    const lineStart = line.startMs ?? 0;
    const lineEnd = line.endMs ?? lineStart + 4000;
    const allowedLineStart = lineStart - 100;
    const allowedLineEnd = lineEnd + 150;

    const expectedTokens = line.original.split(/\s+/).filter(Boolean);
    totalExpectedTokens += expectedTokens.length;
    totalMatchedTokens += line.words.length;

    let prevEnd = allowedLineStart;
    let prevStart = allowedLineStart;

    for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
      const w = line.words[wIdx];
      totalWords++;

      // 1. Boundary containment
      if (w.startMs >= allowedLineStart && w.endMs <= allowedLineEnd) {
        containmentHits++;
      }

      // 2. Strict start < end with min 40ms duration
      const dur = w.endMs - w.startMs;
      const isDurationValid = dur >= 40 && dur <= 6000;

      // 3. Monotonic ordering
      if (w.startMs >= prevStart && isDurationValid) {
        monotonicHits++;
      }

      // 4. Overlap check (max 50ms overlap allowed for blended syllables)
      if (w.startMs < prevEnd - 50) {
        overlapViolations++;
      }

      prevStart = w.startMs;
      prevEnd = w.endMs;
    }
  }

  if (totalWords === 0) {
    return {
      isStructurallyValid: false,
      timingConfidence: 0.0,
      containmentRate: 0.0,
      monotonicityRate: 0.0,
      tokenCoverageRate: 0.0,
      overlapViolations: 0,
      rejectionReason: 'No words to validate',
    };
  }

  const containmentRate = containmentHits / totalWords;
  const monotonicityRate = monotonicHits / totalWords;
  const tokenCoverageRate = totalExpectedTokens > 0 ? Math.min(1.0, totalMatchedTokens / totalExpectedTokens) : 1.0;

  // Composite timing confidence
  let timingConfidence =
    containmentRate * 0.35 +
    monotonicityRate * 0.35 +
    tokenCoverageRate * 0.20 +
    Math.max(0, 1.0 - (overlapViolations / totalWords) * 3) * 0.10;

  timingConfidence = Number(Math.max(0, Math.min(1.0, timingConfidence)).toFixed(3));

  let rejectionReason: string | undefined;
  if (containmentRate < 0.75) {
    rejectionReason = `Poor boundary containment: ${(containmentRate * 100).toFixed(1)}%`;
  } else if (monotonicityRate < 0.80) {
    rejectionReason = `Severe monotonicity violations: ${(monotonicityRate * 100).toFixed(1)}%`;
  } else if (tokenCoverageRate < 0.50) {
    rejectionReason = `Insufficient word coverage: ${(tokenCoverageRate * 100).toFixed(1)}%`;
  } else if (overlapViolations > totalWords * 0.25) {
    rejectionReason = `Excessive word overlaps: ${overlapViolations} overlaps`;
  }

  const isStructurallyValid = rejectionReason === undefined;

  return {
    isStructurallyValid,
    timingConfidence,
    containmentRate: Number(containmentRate.toFixed(3)),
    monotonicityRate: Number(monotonicityRate.toFixed(3)),
    tokenCoverageRate: Number(tokenCoverageRate.toFixed(3)),
    overlapViolations,
    rejectionReason,
  };
}

export function validateCandidate(cand: LyricsCandidate): ValidationResult {
  // 1. If richSync exists (word-by-word timestamps)
  if (cand.richSync && cand.richSync.length > 0) {
    if (cand.richSync.length < 3) {
      return { isValid: false, reason: `Insufficient richSync lines: ${cand.richSync.length} (minimum 3)` };
    }
    let lastTime = -1;
    for (const line of cand.richSync) {
      if (line.ts < 0 || line.te < line.ts) {
        return { isValid: false, reason: `Invalid richSync line time: ts=${line.ts}, te=${line.te}` };
      }
      if (lastTime >= 0 && line.ts < lastTime - 1.0) {
        return { isValid: false, reason: `Non-monotonic richSync timestamp: ${lastTime}s -> ${line.ts}s` };
      }
      lastTime = line.ts;
    }
    const plainText = cand.plainLyrics || cand.richSync.map((l) => l.l.map((w) => w.c).join('')).join('\n');
    return validateLyricsContent(plainText, false);
  }

  // 2. If syncedLyrics exists (LRC format)
  if (cand.syncedLyrics && cand.syncedLyrics.trim().length > 0) {
    return validateLyricsContent(cand.syncedLyrics, true);
  }

  // 3. Plain lyrics
  if (cand.plainLyrics && cand.plainLyrics.trim().length > 0) {
    return validateLyricsContent(cand.plainLyrics, false);
  }

  return { isValid: false, reason: 'Candidate contains no lyrics content' };
}
