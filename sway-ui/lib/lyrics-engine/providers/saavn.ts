/**
 * saavn.ts
 * JioSaavn Lyrics Provider Adapter
 *
 * Indian catalog specialist with response sanitization and plain lyrics candidate generation.
 * Multi-candidate gathering: collects all matching candidate lyrics across IDs and search.
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

const BACKEND_BASE = process.env.INTERNAL_BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

function sanitizeLyricsText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSearchSubtitle(subtitle?: string): { album?: string; artists: string[] } {
  if (!subtitle) return { artists: [] };
  const parts = subtitle.split('·').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const album = parts[0];
    const artists = parts[1].split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i).map((a) => a.trim()).filter(Boolean);
    return { album, artists };
  } else if (parts.length === 1) {
    const artists = parts[0].split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i).map((a) => a.trim()).filter(Boolean);
    return { artists };
  }
  return { artists: [] };
}

export class JioSaavnLyricsProvider implements ILyricsProvider {
  readonly providerId = 'jiosaavn' as const;

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

    const directIds = [identity.providerTrackId, identity.providerId, identity.videoId].filter(Boolean) as string[];

    // 1. Direct lyrics fetch by provider id or song id
    for (const rawId of directIds) {
      const cleanId = rawId.replace(/^[a-zA-Z0-9_-]+:/, '');
      if (seenIds.has(cleanId)) continue;
      seenIds.add(cleanId);

      try {
        const res = await fetch(`${BACKEND_BASE}/api/v1/lyrics/${encodeURIComponent(cleanId)}`, {
          signal: signal || AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const body = await res.json();
          const text = body.data?.plain || body.data?.lyrics || body.data?.snippet;
          if (text && text.trim().length > 15) {
            candidates.push({
              providerId: this.providerId,
              providerTrackId: cleanId,
              title: identity.title,
              artists: identity.artists,
              album: identity.album,
              durationMs: identity.durationMs,
              plainLyrics: sanitizeLyricsText(text),
              instrumental: false,
              sourceReference: 'JioSaavn Official Lyrics',
              providerConfidence: 0.92,
              fetchedAtMs: Date.now(),
              timingProvenance: 'PLAIN',
              timingConfidence: 0.0,
            });
          }
        }
      } catch {
        // Proceed to next ID
      }
    }

    // 2. Search candidates on backend
    if (normalized.cleanTitle) {
      try {
        const searchQ = normalized.primaryArtist
          ? `${normalized.cleanTitle} ${normalized.primaryArtist}`
          : normalized.cleanTitle;

        const res = await fetch(`${BACKEND_BASE}/api/v1/search?q=${encodeURIComponent(searchQ)}&n=5`, {
          signal: signal || AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = await res.json();
          const songs = data.data?.songs || [];
          for (const s of songs) {
            if (!s?.id) continue;
            const cleanId = s.id.replace(/^[a-zA-Z0-9_-]+:/, '');
            if (seenIds.has(cleanId)) continue;
            seenIds.add(cleanId);

            const [lyrRes, songRes] = await Promise.all([
              fetch(`${BACKEND_BASE}/api/v1/songs/${encodeURIComponent(cleanId)}/lyrics`, {
                signal: signal || AbortSignal.timeout(3000),
              }).catch(() => null),
              fetch(`${BACKEND_BASE}/api/v1/songs/${encodeURIComponent(cleanId)}`, {
                signal: signal || AbortSignal.timeout(3000),
              }).catch(() => null),
            ]);

            if (lyrRes && lyrRes.ok) {
              const lyrData = await lyrRes.json();
              const songData = songRes && songRes.ok ? await songRes.json() : null;
              const text = lyrData.data?.plain || lyrData.data?.lyrics;
              if (text && text.trim().length > 15) {
                const songObj = songData?.data;
                const { album: candAlbum, artists: candArtists } = parseSearchSubtitle(s.subtitle);
                const resolvedArtists = (songObj?.artists && songObj.artists.length > 0)
                  ? songObj.artists.map((a: any) => a.name)
                  : (candArtists.length > 0 ? candArtists : (Array.isArray(s.artists) ? s.artists.map((a: any) => a.name) : []));

                candidates.push({
                  providerId: this.providerId,
                  providerTrackId: cleanId,
                  title: songObj?.title || s.title || '',
                  artists: resolvedArtists,
                  album: songObj?.album || candAlbum || s.album,
                  durationMs: songObj?.duration_ms || s.duration_ms,
                  plainLyrics: sanitizeLyricsText(text),
                  instrumental: false,
                  sourceReference: 'JioSaavn Search',
                  providerConfidence: 0.88,
                  fetchedAtMs: Date.now(),
                  timingProvenance: 'PLAIN',
                  timingConfidence: 0.0,
                });
              }
            }
          }
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

export const jioSaavnProvider = new JioSaavnLyricsProvider();
