/**
 * unison.ts
 * Unison Provider Adapter
 *
 * Supports TTML word-level (richsync) and LRC line-level (linesync) synchronized lyrics.
 * Multi-candidate gathering: queries videoId, clean title, and original title strategies,
 * accumulating all valid candidates.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';
import { parseTtmlToRichSync } from '../parsers/richsyncParser';

const UNISON_BASE = 'https://unison.boidu.dev';

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

    const candidates: LyricsCandidate[] = [];
    const seenIds = new Set<string>();

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
        const candidateKey = String(item.id || item.videoId || urlStr);
        if (seenIds.has(candidateKey)) {
          continue;
        }
        seenIds.add(candidateKey);

        const rawLyrics = item.lyrics;

        // Parse depending on format
        if (item.format === 'ttml' || item.syncType === 'richsync') {
          const { richSync, plainText } = parseTtmlToRichSync(rawLyrics);
          if (richSync.length >= 3) {
            candidates.push({
              providerId: 'unison',
              providerTrackId: String(item.id || item.videoId || cleanTitle),
              videoId: item.videoId || identity.videoId,
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
              timingProvenance: 'AUTHENTIC_WORD',
              timingConfidence: 0.94,
            });
          }
        } else if (item.format === 'lrc' || item.syncType === 'linesync') {
          const plainText = rawLyrics.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
          candidates.push({
            providerId: 'unison',
            providerTrackId: String(item.id || item.videoId || cleanTitle),
            videoId: item.videoId || identity.videoId,
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
            timingProvenance: 'LINE',
            timingConfidence: 0.86,
          });
        }
      } catch {
        // Fall through to next strategy
      }
    }

    return candidates;
  }
}

export const unisonProvider = new UnisonProvider();
