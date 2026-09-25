/**
 * lrclib.ts
 * LRCLIB Lyrics Provider Adapter (Section 3.1)
 * Generates candidates from both /api/get and bounded /api/search.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

export class LrclibLyricsProvider implements ILyricsProvider {
  readonly providerId = 'lrclib' as const;

  async resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]> {
    if (!providerHealthTracker.isAvailable(this.providerId)) {
      return [];
    }

    const startTime = Date.now();
    const candidates: LyricsCandidate[] = [];
    const seenIds = new Set<string>();

    const addCandidate = (item: any) => {
      if (!item || (!item.syncedLyrics && !item.plainLyrics && !item.instrumental)) return;
      const idStr = String(item.id || '');
      if (idStr && seenIds.has(idStr)) return;
      if (idStr) seenIds.add(idStr);

      const artists = (item.artistName || '')
        .split(/[,&/|]/)
        .map((a: string) => a.trim())
        .filter(Boolean);

      candidates.push({
        providerId: this.providerId,
        providerTrackId: idStr,
        title: item.trackName,
        artists: artists.length > 0 ? artists : [item.artistName || ''],
        album: item.albumName || undefined,
        durationMs: item.duration ? Math.round(item.duration * 1000) : undefined,
        plainLyrics: item.plainLyrics || undefined,
        syncedLyrics: item.syncedLyrics || undefined,
        instrumental: Boolean(item.instrumental),
        sourceReference: `https://lrclib.net/api/get/${item.id}`,
        fetchedAtMs: Date.now(),
      });
    };

    // 1. Direct /api/get candidate lookup
    if (normalized.cleanTitle && normalized.primaryArtist) {
      try {
        const params = new URLSearchParams({
          track_name: normalized.cleanTitle,
          artist_name: normalized.primaryArtist,
        });
        if (normalized.cleanAlbum) params.append('album_name', normalized.cleanAlbum);
        if (identity.durationMs > 0) params.append('duration', Math.round(identity.durationMs / 1000).toString());

        const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
          headers: { 'Lrclib-Client': 'SwayMusic/2.0 (https://github.com/sway)' },
          signal: signal || AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = await res.json();
          addCandidate(data);
        } else if (res.status === 429) {
          providerHealthTracker.recordFailure(this.providerId, 'RATE_LIMITED');
        }
      } catch (err: any) {
        if (err?.name === 'TimeoutError') {
          providerHealthTracker.recordFailure(this.providerId, 'TIMEOUT');
        }
      }
    }

    // 2. Bounded Search Candidates from searchQueries (Max 3 search queries to respect latency)
    for (const q of normalized.searchQueries.slice(0, 3)) {
      if (!q) continue;
      try {
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
          headers: { 'Lrclib-Client': 'SwayMusic/2.0 (https://github.com/sway)' },
          signal: signal || AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            for (const item of list.slice(0, 5)) {
              addCandidate(item);
            }
          }
        } else if (res.status === 429) {
          providerHealthTracker.recordFailure(this.providerId, 'RATE_LIMITED');
          break;
        }
      } catch (err: any) {
        if (err?.name === 'TimeoutError') {
          providerHealthTracker.recordFailure(this.providerId, 'TIMEOUT');
        }
      }
    }

    const elapsed = Date.now() - startTime;
    if (candidates.length > 0) {
      providerHealthTracker.recordSuccess(this.providerId, elapsed);
    } else {
      providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', elapsed);
    }

    return candidates;
  }
}

export const lrclibProvider = new LrclibLyricsProvider();
