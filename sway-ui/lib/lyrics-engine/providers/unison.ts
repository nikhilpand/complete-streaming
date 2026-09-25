/**
 * unison.ts
 * Unison Provider Adapter (Crowdsourced Sync Engine used by Vivi-Music & Better-Lyrics)
 *
 * Supports TTML word-level (richsync) and LRC line-level (linesync) synchronized lyrics.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate, RichSyncLine } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

const UNISON_BASE = 'https://unison.boidu.dev';

function parseTtmlTime(str: string): number {
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

function parseTtmlToRichSync(ttml: string): { richSync: RichSyncLine[]; plainText: string } {
  const richSync: RichSyncLine[] = [];
  const plainLines: string[] = [];

  const pRegex = /<p\s+[^>]*begin=["']([^"']+)["'][^>]*end=["']([^"']+)["'][^>]*>([\s\S]*?)<\/p>/gi;
  const spanRegex = /<span\s+[^>]*begin=["']([^"']+)["'][^>]*end=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi;

  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(ttml)) !== null) {
    const pBegin = parseTtmlTime(pMatch[1]);
    const pEnd = parseTtmlTime(pMatch[2]);
    const innerHtml = pMatch[3];

    const words: Array<{ c: string; o: number }> = [];
    let sMatch: RegExpExecArray | null;

    spanRegex.lastIndex = 0;
    while ((sMatch = spanRegex.exec(innerHtml)) !== null) {
      const sBegin = parseTtmlTime(sMatch[1]);
      const rawText = sMatch[3].replace(/<[^>]+>/g, '').trim();
      if (rawText) {
        words.push({
          c: rawText + ' ',
          o: Math.max(0, sBegin - pBegin),
        });
      }
    }

    const lineText = innerHtml.replace(/<[^>]+>/g, '').trim();
    if (lineText) {
      plainLines.push(lineText);
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

export class UnisonProvider implements ILyricsProvider {
  readonly providerId = 'unison';

  async resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]> {
    if (!providerHealthTracker.isAvailable('unison')) {
      return [];
    }

    const primaryArtist = identity.artists[0] || '';
    const cleanTitle = normalized.cleanTitle || identity.title;

    // Build lookup strategies
    const strategies: string[] = [];

    // Strategy 1: videoId if available
    if (identity.videoId) {
      strategies.push(`${UNISON_BASE}/lyrics?v=${encodeURIComponent(identity.videoId)}`);
    }

    // Strategy 2: cleanTitle + artist + duration
    const durSec = identity.durationMs > 0 ? Math.round(identity.durationMs / 1000) : 0;
    if (cleanTitle && primaryArtist) {
      let url = `${UNISON_BASE}/lyrics?song=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(primaryArtist)}`;
      if (durSec > 0) url += `&duration=${durSec}`;
      strategies.push(url);
    }

    // Strategy 3: original title + artist
    if (identity.title !== cleanTitle && identity.title && primaryArtist) {
      let url = `${UNISON_BASE}/lyrics?song=${encodeURIComponent(identity.title)}&artist=${encodeURIComponent(primaryArtist)}`;
      if (durSec > 0) url += `&duration=${durSec}`;
      strategies.push(url);
    }

    for (const urlStr of strategies) {
      try {
        const timeoutSignal = AbortSignal.timeout(3000);
        const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        const startTime = Date.now();
        const res = await fetch(urlStr, {
          signal: combinedSignal,
          headers: {
            'User-Agent': 'SWAY-UltraLyrics/2.0',
            Accept: 'application/json',
          },
        });
        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
          if (res.status === 429) {
            providerHealthTracker.recordFailure('unison', 'RATE_LIMITED', latencyMs);
          } else if (res.status >= 500) {
            providerHealthTracker.recordFailure('unison', 'SERVER_ERROR', latencyMs);
          }
          continue;
        }

        const json = await res.json();
        if (!json.success || !json.data || !json.data.lyrics) {
          continue;
        }

        providerHealthTracker.recordSuccess('unison', latencyMs);
        const item = json.data;
        const rawLyrics = item.lyrics;

        // Parse depending on format
        if (item.format === 'ttml' || item.syncType === 'richsync') {
          const { richSync, plainText } = parseTtmlToRichSync(rawLyrics);
          if (richSync.length >= 3) {
            return [
              {
                providerId: 'unison',
                providerTrackId: String(item.id || item.videoId || cleanTitle),
                title: item.song || cleanTitle,
                artists: [item.artist || primaryArtist],
                album: item.album || identity.album,
                durationMs: item.duration ? item.duration * 1000 : identity.durationMs,
                richSync,
                plainLyrics: plainText,
                instrumental: false,
                sourceReference: `unison:ttml:${item.id || 'direct'}`,
                providerConfidence: 0.96,
                fetchedAtMs: Date.now(),
              },
            ];
          }
        } else if (item.format === 'lrc' || item.syncType === 'linesync') {
          const plainText = rawLyrics.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
          return [
            {
              providerId: 'unison',
              providerTrackId: String(item.id || item.videoId || cleanTitle),
              title: item.song || cleanTitle,
              artists: [item.artist || primaryArtist],
              album: item.album || identity.album,
              durationMs: item.duration ? item.duration * 1000 : identity.durationMs,
              syncedLyrics: rawLyrics,
              plainLyrics: plainText,
              instrumental: false,
              sourceReference: `unison:lrc:${item.id || 'direct'}`,
              providerConfidence: 0.90,
              fetchedAtMs: Date.now(),
            },
          ];
        } else if (typeof rawLyrics === 'string' && rawLyrics.trim().length > 30) {
          return [
            {
              providerId: 'unison',
              providerTrackId: String(item.id || item.videoId || cleanTitle),
              title: item.song || cleanTitle,
              artists: [item.artist || primaryArtist],
              album: item.album || identity.album,
              durationMs: item.duration ? item.duration * 1000 : identity.durationMs,
              plainLyrics: rawLyrics.trim(),
              instrumental: false,
              sourceReference: `unison:plain:${item.id || 'direct'}`,
              providerConfidence: 0.75,
              fetchedAtMs: Date.now(),
            },
          ];
        }
      } catch {
        // Fall through to next strategy
      }
    }

    return [];
  }
}

export const unisonProvider = new UnisonProvider();
