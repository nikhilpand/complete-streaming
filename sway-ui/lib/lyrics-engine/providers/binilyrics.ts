/**
 * binilyrics.ts
 * BiniLyrics / LyricsPlus Provider Adapter (Used by Vivi-Music, YouLy+, ArchiveTune)
 *
 * Fetches Apple Music / TTML word-by-word synchronized lyrics from lyricsplus mirrors.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate, RichSyncLine } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

const MIRRORS = [
  'https://lyricsplus.binimum.org/v2/lyrics/get',
  'https://lyrics-api.binimum.org/v2/lyrics/get',
  'https://atomix.one/lyrics/get',
];

export class BiniLyricsProvider implements ILyricsProvider {
  readonly providerId = 'binilyrics';

  async resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]> {
    if (!providerHealthTracker.isAvailable('binilyrics')) {
      return [];
    }

    const titles = Array.from(new Set([normalized.cleanTitle, identity.title].filter(Boolean)));
    const artists = identity.artists.slice(0, 3).filter((a) => a && a !== 'Unknown Artist');
    if (artists.length === 0) artists.push('');

    const queries: { title: string; artist: string }[] = [];
    for (const art of artists) {
      for (const tit of titles) {
        queries.push({ title: tit, artist: art });
      }
    }

    for (const q of queries) {
      if (!q.title.trim()) continue;

      for (const mirror of MIRRORS) {
        try {
          const url = new URL(mirror);
          url.searchParams.set('title', q.title);
          url.searchParams.set('artist', q.artist);
          if (identity.durationMs > 0) {
            url.searchParams.set('duration', Math.round(identity.durationMs / 1000).toString());
          }

          const timeoutSignal = AbortSignal.timeout(3000);
          const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

          const startTime = Date.now();
          const res = await fetch(url.toString(), {
            signal: combinedSignal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
              Accept: 'application/json',
            },
          });
          const latencyMs = Date.now() - startTime;

          if (!res.ok) {
            if (res.status === 429) {
              providerHealthTracker.recordFailure('binilyrics', 'RATE_LIMITED', latencyMs);
            } else if (res.status >= 500) {
              providerHealthTracker.recordFailure('binilyrics', 'SERVER_ERROR', latencyMs);
            }
            continue;
          }

          const data = await res.json();
          providerHealthTracker.recordSuccess('binilyrics', latencyMs);

          const lyrics = data.lyrics;
          if (!Array.isArray(lyrics) || lyrics.length === 0) {
            continue;
          }

          if (data.type === 'Word') {
            const richSync: RichSyncLine[] = lyrics.map((l: any) => ({
              ts: l.time / 1000.0,
              te: (l.time + (l.duration || 2000)) / 1000.0,
              l: (l.syllabus || []).map((s: any) => ({
                c: s.text,
                o: (s.time - l.time) / 1000.0,
                d: s.duration ? s.duration / 1000.0 : undefined,
              })),
            }));

            const plainText = lyrics.map((l: any) => l.text).join('\n');
            const lastLine = richSync[richSync.length - 1];
            const derivedDurationMs = lastLine ? Math.round(lastLine.te * 1000) : (data.metadata?.duration ? data.metadata.duration * 1000 : identity.durationMs);

            return [
              {
                providerId: 'binilyrics',
                providerTrackId: data.metadata?.title || q.title,
                title: data.metadata?.title || q.title,
                artists: [q.artist],
                durationMs: derivedDurationMs,
                richSync,
                plainLyrics: plainText,
                instrumental: false,
                sourceReference: `binilyrics:${data.metadata?.source || 'apple'}`,
                providerConfidence: 0.98,
                fetchedAtMs: Date.now(),
              },
            ];
          } else if (data.type === 'Line') {
            const lrcLines = lyrics
              .map((l: any) => {
                const totalSec = l.time / 1000.0;
                const m = Math.floor(totalSec / 60);
                const s = Math.floor(totalSec % 60);
                const ms = Math.floor((totalSec % 1) * 100);
                const tag = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}]`;
                return `${tag} ${l.text || ''}`;
              })
              .join('\n');

            const lastLine = lyrics[lyrics.length - 1];
            const derivedDurationMs = lastLine?.time ? Math.round(lastLine.time + 3000) : (data.metadata?.duration ? data.metadata.duration * 1000 : identity.durationMs);

            return [
              {
                providerId: 'binilyrics',
                providerTrackId: data.metadata?.title || q.title,
                title: data.metadata?.title || q.title,
                artists: [q.artist],
                durationMs: derivedDurationMs,
                syncedLyrics: lrcLines,
                plainLyrics: lyrics.map((l: any) => l.text).join('\n'),
                instrumental: false,
                sourceReference: `binilyrics:${data.metadata?.source || 'line'}`,
                providerConfidence: 0.92,
                fetchedAtMs: Date.now(),
              },
            ];
          }
        } catch {
          // Fall through to next mirror / query
        }
      }
    }

    return [];
  }
}

export const biniLyricsProvider = new BiniLyricsProvider();
