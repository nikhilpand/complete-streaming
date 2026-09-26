/**
 * musixmatch.ts
 * Musixmatch Provider Adapter
 *
 * Supports RichSync word timing and LRC subtitles.
 * Multi-candidate gathering: inspects all returned search tracks instead of taking only the first one.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate, RichSyncLine } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

const MUSIXMATCH_OFFICIAL_ENABLED = process.env.MUSIXMATCH_OFFICIAL === 'true';
const MUSIXMATCH_APP_PROTOCOL_ENABLED = process.env.MUSIXMATCH_APP_PROTOCOL !== 'false';

let memoryToken: { token: string; expiresAt: number } | null = null;

async function getOrFetchToken(signal?: AbortSignal): Promise<string | null> {
  if (process.env.MUSIXMATCH_USER_TOKEN) {
    return process.env.MUSIXMATCH_USER_TOKEN;
  }

  const now = Date.now();
  if (memoryToken && memoryToken.expiresAt > now) {
    return memoryToken.token;
  }

  try {
    const res = await fetch('https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0', {
      headers: {
        'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
      },
      signal: signal || AbortSignal.timeout(3500),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const header = data?.message?.header;

    if (header?.hint === 'captcha' || header?.status_code === 401) {
      providerHealthTracker.recordFailure('musixmatch', 'CAPTCHA');
      return null;
    }

    const token = data?.message?.body?.user_token;
    if (token && typeof token === 'string' && token !== '00000000000000000000000000000000000000000000000000000000') {
      memoryToken = {
        token,
        expiresAt: now + 4 * 3600 * 1000,
      };
      return token;
    }
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      providerHealthTracker.recordFailure('musixmatch', 'TIMEOUT');
    }
  }

  return null;
}

export class MusixmatchLyricsProvider implements ILyricsProvider {
  readonly providerId = 'musixmatch' as const;

  async resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]> {
    if (!MUSIXMATCH_APP_PROTOCOL_ENABLED && !MUSIXMATCH_OFFICIAL_ENABLED) {
      return [];
    }

    if (!providerHealthTracker.isAvailable(this.providerId)) {
      return [];
    }

    const token = await getOrFetchToken(signal);
    if (!token) {
      return [];
    }

    const startTime = Date.now();
    const candidates: LyricsCandidate[] = [];
    const seenTrackIds = new Set<number>();

    // 1. Gather candidate tracks from search
    const matchingTracks: Array<{
      trackId: number;
      trackName: string;
      artistName: string;
      hasSubtitles: boolean;
      hasRichSync: boolean;
    }> = [];

    for (const q of normalized.searchQueries.slice(0, 2)) {
      if (!q) continue;
      try {
        const url = `https://apic-appmobile.musixmatch.com/ws/1.1/track.search?format=json&app_id=mac-ios-v2.0&q=${encodeURIComponent(q)}&f_has_lyrics=1&page_size=5&usertoken=${encodeURIComponent(token)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0' },
          signal: signal || AbortSignal.timeout(3500),
        });

        if (!res.ok) {
          if (res.status === 401) providerHealthTracker.recordFailure(this.providerId, 'CAPTCHA');
          continue;
        }

        const data = await res.json();
        const header = data?.message?.header;
        if (header?.hint === 'captcha' || header?.status_code === 401) {
          providerHealthTracker.recordFailure(this.providerId, 'CAPTCHA');
          break;
        }

        const trackList = data?.message?.body?.track_list;
        if (Array.isArray(trackList) && trackList.length > 0) {
          for (const item of trackList.slice(0, 4)) {
            const t = item?.track;
            if (t?.track_id && !seenTrackIds.has(t.track_id)) {
              seenTrackIds.add(t.track_id);
              matchingTracks.push({
                trackId: t.track_id,
                trackName: t.track_name || identity.title,
                artistName: t.artist_name || normalized.primaryArtist,
                hasSubtitles: Boolean(t.has_subtitles),
                hasRichSync: Boolean(t.has_richsync),
              });
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'TimeoutError') {
          providerHealthTracker.recordFailure(this.providerId, 'TIMEOUT');
        }
      }
    }

    if (matchingTracks.length === 0) {
      providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', Date.now() - startTime);
      return [];
    }

    // 2. Fetch lyrics (richsync and subtitles) for all gathered candidate tracks
    for (const t of matchingTracks) {
      let candidateRichSync: RichSyncLine[] | undefined;
      let candidateSyncedLrc: string | undefined;

      if (t.hasRichSync) {
        try {
          const richUrl = `https://apic-appmobile.musixmatch.com/ws/1.1/track.richsync.get?format=json&app_id=mac-ios-v2.0&track_id=${t.trackId}&usertoken=${encodeURIComponent(token)}`;
          const richRes = await fetch(richUrl, {
            headers: { 'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0' },
            signal: signal || AbortSignal.timeout(3500),
          });

          if (richRes.ok) {
            const richData = await richRes.json();
            const rawBody = richData?.message?.body?.richsync?.richsync_body;
            if (rawBody) {
              const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
              if (Array.isArray(parsed) && parsed.length > 0) {
                candidateRichSync = parsed;
              }
            }
          }
        } catch {
          // Fall back to subtitles
        }
      }

      if (t.hasSubtitles || !candidateRichSync) {
        try {
          const subUrl = `https://apic-appmobile.musixmatch.com/ws/1.1/track.subtitle.get?format=json&app_id=mac-ios-v2.0&track_id=${t.trackId}&subtitle_format=lrc&usertoken=${encodeURIComponent(token)}`;
          const subRes = await fetch(subUrl, {
            headers: { 'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0' },
            signal: signal || AbortSignal.timeout(3500),
          });

          if (subRes.ok) {
            const subData = await subRes.json();
            const lrc = subData?.message?.body?.subtitle?.subtitle_body;
            if (lrc && lrc.trim().length > 15) {
              candidateSyncedLrc = lrc;
            }
          }
        } catch {
          // Ignore
        }
      }

      if (candidateRichSync || candidateSyncedLrc) {
        let derivedDurationMs = identity.durationMs;
        if (candidateRichSync && candidateRichSync.length > 0) {
          const lastLine = candidateRichSync[candidateRichSync.length - 1];
          if (lastLine?.te) derivedDurationMs = Math.round(lastLine.te * 1000);
        }

        candidates.push({
          providerId: this.providerId,
          providerTrackId: String(t.trackId),
          title: t.trackName,
          artists: [t.artistName],
          durationMs: derivedDurationMs,
          richSync: candidateRichSync,
          syncedLyrics: candidateSyncedLrc,
          instrumental: false,
          sourceReference: `Musixmatch Track #${t.trackId}`,
          providerConfidence: candidateRichSync ? 0.98 : 0.94,
          fetchedAtMs: Date.now(),
          timingProvenance: candidateRichSync ? 'AUTHENTIC_WORD' : 'LINE',
          timingConfidence: candidateRichSync ? 0.96 : 0.88,
        });
      }
    }

    if (candidates.length > 0) {
      providerHealthTracker.recordSuccess(this.providerId, Date.now() - startTime);
    } else {
      providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', Date.now() - startTime);
    }

    return candidates;
  }
}

export const musixmatchProvider = new MusixmatchLyricsProvider();
