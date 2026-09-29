'use client';

import { parseLRC, type ParsedLyricLine } from '@/lib/lyric-parser';
import { isDevanagari, devanagariToRoman, isNonLatinScript, romanizeMixedText } from '@/lib/transliteration';
import { artistNames } from '@/lib/utils';
import type { Song } from '@/lib/api/types';
import type { LyricsTimingProvenance } from '@/lib/lyrics-engine/types';

export type LyricsCacheStatus = 'FOUND' | 'NOT_FOUND' | 'ERROR';

export interface CachedLyrics {
  trackId: string;
  recordingKey?: string;
  canonicalTrackKey?: string;
  lines: ParsedLyricLine[];
  provider: string;
  syncQuality: string;
  provenance: LyricsTimingProvenance | null;
  hasHindiScript: boolean;
  status: LyricsCacheStatus;
  error?: 'NETWORK_ERROR' | 'SERVER_ERROR' | string;
  cachedAt: number;
  expiresAt: number;
  plainText?: string;
  engineVersion?: string;
  synced: boolean;
  hasWordTiming?: boolean;
  confidence?: number;
  capabilities?: {
    plain: boolean;
    lineSync: boolean;
    wordSync: boolean;
    romanized: boolean;
  };
}

export const CLIENT_ENGINE_VERSION = 'v6';
export const CACHE_VERSION = `lyrics-${CLIENT_ENGINE_VERSION}`;
const FOUND_TTL_MS = 20 * 60 * 1000; // 20 minutes (matches server L1 cache)
const NOT_FOUND_TTL_MS = 15 * 1000;  // 15 seconds short-lived negative cache
const MAX_CACHE_ITEMS = 200;

// Authoritative client-side in-memory lyrics cache
const lyricsMemoryCache = new Map<string, CachedLyrics>();
// Deduplication map for in-flight fetch promises to prevent redundant network calls
const inFlightRequests = new Map<string, Promise<CachedLyrics>>();
const inFlightPromiseGeneration = new Map<string, number>();
const invalidationGeneration = new Map<string, number>();

function getGeneration(key: string): number {
  return invalidationGeneration.get(key) ?? 0;
}

function bumpGeneration(key: string): number {
  const next = getGeneration(key) + 1;
  invalidationGeneration.set(key, next);
  return next;
}

export function makeRecordingKey(trackId?: string, provider?: string, providerTrackId?: string): string | null {
  if (trackId && trackId.trim()) {
    const trimmed = trackId.trim();
    if (trimmed.startsWith('yt:')) return `youtube:${trimmed.slice(3)}`;
    if (trimmed.includes(':')) return trimmed;
    if (provider && provider.trim()) return `${provider.trim()}:${trimmed}`;
    return trimmed;
  }
  if (provider && providerTrackId) {
    const p = provider.trim();
    let id = providerTrackId.trim();
    if (id.startsWith('yt:')) id = id.slice(3);
    else if (id.startsWith(`${p}:`)) id = id.slice(p.length + 1);
    return `${p}:${id}`;
  }
  return null;
}

/**
 * Deletes all cache entries associated with a track ID, recording key, or its aliases.
 * Removes both recording-keyed synced entries and stripped plain-text entries.
 */
export function deleteCacheEntriesForTrack(trackId: string) {
  const suppliedTrackId = trackId.trim();
  const normalizedTrackId = makeRecordingKey(suppliedTrackId) || suppliedTrackId;

  const keysToDelete = new Set<string>();
  keysToDelete.add(`${CACHE_VERSION}:rec:${suppliedTrackId}`);
  if (normalizedTrackId !== suppliedTrackId) {
    keysToDelete.add(`${CACHE_VERSION}:rec:${normalizedTrackId}`);
  }

  for (const [key, entry] of lyricsMemoryCache.entries()) {
    const entryNormTrack = entry.trackId ? (makeRecordingKey(entry.trackId) || entry.trackId) : null;
    const entryNormRec = entry.recordingKey ? (makeRecordingKey(entry.recordingKey) || entry.recordingKey) : null;
    const entryNormCanon = entry.canonicalTrackKey ? (makeRecordingKey(entry.canonicalTrackKey) || entry.canonicalTrackKey) : null;

    const matches =
      entry.trackId === suppliedTrackId ||
      entry.recordingKey === suppliedTrackId ||
      entry.canonicalTrackKey === suppliedTrackId ||
      (entryNormTrack !== null && entryNormTrack === normalizedTrackId) ||
      (entryNormRec !== null && entryNormRec === normalizedTrackId) ||
      (entryNormCanon !== null && entryNormCanon === normalizedTrackId);

    if (matches) {
      keysToDelete.add(key);
      if (entry.recordingKey) {
        keysToDelete.add(`${CACHE_VERSION}:rec:${entry.recordingKey}`);
        const norm = makeRecordingKey(entry.recordingKey);
        if (norm) keysToDelete.add(`${CACHE_VERSION}:rec:${norm}`);
      }
      if (entry.trackId) {
        keysToDelete.add(`${CACHE_VERSION}:rec:${entry.trackId}`);
        const norm = makeRecordingKey(entry.trackId);
        if (norm) keysToDelete.add(`${CACHE_VERSION}:rec:${norm}`);
      }
      if (entry.canonicalTrackKey) {
        keysToDelete.add(`${CACHE_VERSION}:rec:${entry.canonicalTrackKey}`);
        const norm = makeRecordingKey(entry.canonicalTrackKey);
        if (norm) keysToDelete.add(`${CACHE_VERSION}:rec:${norm}`);
      }
    }
  }

  for (const k of keysToDelete) {
    lyricsMemoryCache.delete(k);
  }
}

/**
 * Retrieves cached lyrics.
 * Crucial Invariant: Synced lyrics with timing are ONLY accessible via recording-based identity
 * (trackId / recordingKey). Title+artist queries are strictly restricted to plain-text candidates,
 * preventing cross-recording timing contamination across live/remaster/cover versions.
 */
export function getCachedLyrics(
  trackId?: string,
  title?: string,
  artist?: string
): CachedLyrics | null {
  const now = Date.now();

  // 1. Recording-based lookup (Authority for timing & synced lyrics)
  if (trackId && trackId.trim()) {
    const rawId = trackId.trim();
    const normalizedId = makeRecordingKey(rawId) || rawId;

    let entry = lyricsMemoryCache.get(`${CACHE_VERSION}:rec:${rawId}`);
    if (!entry && normalizedId !== rawId) {
      entry = lyricsMemoryCache.get(`${CACHE_VERSION}:rec:${normalizedId}`);
    }

    if (entry) {
      if (now > entry.expiresAt || entry.status === 'ERROR') {
        deleteCacheEntriesForTrack(rawId);
        return null;
      }

      // Check engine version and recordingKey invariants for FOUND entries
      if (entry.status === 'FOUND') {
        if (entry.engineVersion !== CLIENT_ENGINE_VERSION) {
          deleteCacheEntriesForTrack(rawId);
          return null;
        }

        if (entry.synced && !entry.recordingKey) {
          deleteCacheEntriesForTrack(rawId);
          return null;
        }
      }

      return entry;
    }
    // If a trackId was provided and not found, NEVER return another recording's synced lyrics
    return null;
  }

  // 2. Title + Artist plain-text fallback (Never used as an authority for timing)
  if (title && title.trim()) {
    const cleanTitle = title.toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
    const cleanArtist = (artist || '').toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
    if (cleanTitle) {
      const plainKey = `${CACHE_VERSION}:plain:${cleanTitle}::${cleanArtist}`;
      const entry = lyricsMemoryCache.get(plainKey);
      if (entry) {
        if (now > entry.expiresAt || entry.status === 'ERROR') {
          lyricsMemoryCache.delete(plainKey);
          return null;
        }
        if (entry.status === 'FOUND' && entry.engineVersion !== CLIENT_ENGINE_VERSION) {
          if (entry.trackId && !entry.trackId.startsWith('title:')) {
            deleteCacheEntriesForTrack(entry.trackId);
          } else {
            lyricsMemoryCache.delete(plainKey);
          }
          return null;
        }
        // ONLY return plain-text lyrics, never timed/synced lyrics via title::artist lookup
        if (entry.status === 'FOUND' && (!entry.synced || entry.syncQuality === 'NONE')) {
          return entry;
        }
        lyricsMemoryCache.delete(plainKey);
      }
    }
  }

  return null;
}

/**
 * Stores lyrics in the authoritative client cache.
 * Errors (NETWORK_ERROR, SERVER_ERROR) are NEVER cached.
 * NOT_FOUND is negative-cached with a 15-second TTL.
 * FOUND lyrics are cached with a 20-minute TTL.
 */
export function setCachedLyrics(
  entry: CachedLyrics,
  title?: string,
  artist?: string
) {
  // Do not cache transient network or server errors
  if (entry.status === 'ERROR') return;

  if (entry.status === 'FOUND' && !entry.engineVersion) {
    entry.engineVersion = CLIENT_ENGINE_VERSION;
  }

  // 1. Bind to recording identity
  // Synced lyrics MUST require a real recordingKey.
  // If entry is synced and has NO recordingKey, timed/synced data MUST NOT become recording-authoritative cache data!
  if (!(entry.status === 'FOUND' && entry.synced && !entry.recordingKey)) {
    const recKeys = new Set<string>();
    if (entry.recordingKey && !entry.recordingKey.startsWith('title:')) {
      recKeys.add(`${CACHE_VERSION}:rec:${entry.recordingKey}`);
      const norm = makeRecordingKey(entry.recordingKey);
      if (norm) recKeys.add(`${CACHE_VERSION}:rec:${norm}`);
    }
    if (entry.trackId && !entry.trackId.startsWith('title:')) {
      if (!entry.synced || entry.recordingKey) {
        recKeys.add(`${CACHE_VERSION}:rec:${entry.trackId}`);
        const norm = makeRecordingKey(entry.trackId);
        if (norm) recKeys.add(`${CACHE_VERSION}:rec:${norm}`);
      }
    }
    if (entry.canonicalTrackKey && !entry.canonicalTrackKey.startsWith('title:')) {
      if (!entry.synced || entry.recordingKey) {
        recKeys.add(`${CACHE_VERSION}:rec:${entry.canonicalTrackKey}`);
        const norm = makeRecordingKey(entry.canonicalTrackKey);
        if (norm) recKeys.add(`${CACHE_VERSION}:rec:${norm}`);
      }
    }

    for (const k of recKeys) {
      lyricsMemoryCache.set(k, entry);
    }
  }

  // 2. Candidate for plain text only (if plainText is available or entry is non-synced)
  if (title && title.trim() && entry.status === 'FOUND') {
    const cleanTitle = title.toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
    const cleanArtist = (artist || '').toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
    if (cleanTitle) {
      const plainKey = `${CACHE_VERSION}:plain:${cleanTitle}::${cleanArtist}`;
      const plainText = entry.plainText || (entry.lines.length > 0 ? entry.lines.map((l) => l.text).join('\n') : '');
      const plainLines = plainText
        ? plainText.split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({
            time: -1,
            endTime: -1,
            text,
            romanized: isDevanagari(text) ? devanagariToRoman(text) : undefined,
            words: [],
            isInstrumental: false,
          }))
        : entry.lines.map((l) => ({
            time: -1,
            endTime: -1,
            text: l.text,
            romanized: l.romanized || (isDevanagari(l.text) ? devanagariToRoman(l.text) : undefined),
            words: [],
            isInstrumental: false,
          }));

      const strippedEntry: CachedLyrics = {
        ...entry,
        lines: plainLines,
        synced: false,
        syncQuality: 'NONE',
        hasWordTiming: false,
        provenance: null,
      };
      lyricsMemoryCache.set(plainKey, strippedEntry);
    }
  }

  // Bounded cache eviction
  while (lyricsMemoryCache.size > MAX_CACHE_ITEMS) {
    const oldestKey = lyricsMemoryCache.keys().next().value;
    if (oldestKey) lyricsMemoryCache.delete(oldestKey);
    else break;
  }
}

/**
 * Invalidates client lyrics cache entries, either for a specific track or globally.
 */
export function invalidateLyricsCache(trackId?: string) {
  if (!trackId) {
    lyricsMemoryCache.clear();
    for (const key of inFlightRequests.keys()) {
      bumpGeneration(key);
    }
    return;
  }
  const rawId = trackId.trim();
  const normalizedId = makeRecordingKey(rawId) || rawId;

  // Bump generation for that request identity
  bumpGeneration(`rec:${rawId}`);
  if (normalizedId !== rawId) {
    bumpGeneration(`rec:${normalizedId}`);
  }

  // Also bump generation for any inFlightRequests that match entries being deleted
  for (const [, entry] of lyricsMemoryCache.entries()) {
    const entryNormTrack = entry.trackId ? (makeRecordingKey(entry.trackId) || entry.trackId) : null;
    const entryNormRec = entry.recordingKey ? (makeRecordingKey(entry.recordingKey) || entry.recordingKey) : null;

    if (
      entry.trackId === rawId ||
      entry.recordingKey === rawId ||
      (entryNormTrack !== null && entryNormTrack === normalizedId) ||
      (entryNormRec !== null && entryNormRec === normalizedId)
    ) {
      if (entry.trackId) {
        bumpGeneration(`rec:${entry.trackId}`);
        const norm = makeRecordingKey(entry.trackId);
        if (norm) bumpGeneration(`rec:${norm}`);
      }
      if (entry.recordingKey) {
        bumpGeneration(`rec:${entry.recordingKey}`);
        const norm = makeRecordingKey(entry.recordingKey);
        if (norm) bumpGeneration(`rec:${norm}`);
      }
    }
  }

  deleteCacheEntriesForTrack(rawId);
}

/**
 * Fetches lyrics with authoritative in-memory caching and in-flight deduplication.
 * Accurately differentiates:
 * - FOUND (20m TTL)
 * - NOT_FOUND (15s TTL)
 * - NETWORK_ERROR (not cached)
 * - SERVER_ERROR (not cached)
 */
export async function fetchLyricsWithCache(params: {
  songId?: string;
  title: string;
  artist?: string;
  album?: string;
  subtitle?: string;
  duration?: number;
  lyricsId?: string;
  streamUrl?: string;
}): Promise<CachedLyrics> {
  const songId = params.songId?.trim() || undefined;
  const normalizedSongId = songId ? (makeRecordingKey(songId) || songId) : undefined;
  // NEVER treat lyricsId as recordingKey. lyricsId is only a resolver/provider parameter.
  const inFlightKey = normalizedSongId
    ? `rec:${normalizedSongId}`
    : `title:${(params.title || '').trim()}::${(params.artist || '').trim()}`;
  const requestGeneration = getGeneration(inFlightKey);

  // 1. Fast cache check
  const cached = getCachedLyrics(songId, params.title, params.artist);
  if (cached) {
    return cached;
  }

  // 2. In-flight request deduplication
  const existingPromise = inFlightRequests.get(inFlightKey);
  if (existingPromise && inFlightPromiseGeneration.get(inFlightKey) === requestGeneration) {
    const res = await existingPromise;
    if (res) return res;
  }

  // 3. Network fetch
  const fetchPromise: Promise<CachedLyrics> = (async (): Promise<CachedLyrics> => {
    try {
      if (!params.title || !params.title.trim()) {
        const notFoundDoc: CachedLyrics = {
          trackId: songId || inFlightKey,
          lines: [],
          provider: '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'NOT_FOUND',
          cachedAt: Date.now(),
          expiresAt: Date.now() + NOT_FOUND_TTL_MS,
          engineVersion: CLIENT_ENGINE_VERSION,
          synced: false,
        };
        return notFoundDoc;
      }

      const searchParams = new URLSearchParams({
        title: params.title.trim(),
      });
      if (params.artist) searchParams.set('artist', params.artist.trim());
      if (params.album) searchParams.set('album', params.album.trim());
      if (params.subtitle) searchParams.set('subtitle', params.subtitle.trim());
      if (params.duration && params.duration > 0) searchParams.set('duration', params.duration.toString());
      if (params.songId) searchParams.set('songId', params.songId);
      if (params.lyricsId) searchParams.set('lyricsId', params.lyricsId);
      if (params.streamUrl) searchParams.set('stream_url', params.streamUrl);

      let res: Response;
      try {
        res = await fetch(`/api/lyrics/resolve?${searchParams.toString()}`);
      } catch (netErr) {
        // NETWORK_ERROR: DO NOT CACHE
        console.warn('Network error during lyrics fetch:', netErr);
        return {
          trackId: songId || inFlightKey,
          lines: [],
          provider: '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'ERROR',
          error: 'NETWORK_ERROR',
          cachedAt: Date.now(),
          expiresAt: 0,
          synced: false,
        };
      }

      // Check HTTP status
      if (!res.ok) {
        // HTTP 404 is a legitimate NOT_FOUND
        if (res.status === 404) {
          const notFoundEntry: CachedLyrics = {
            trackId: songId || inFlightKey,
            lines: [],
            provider: '',
            syncQuality: 'NONE',
            provenance: null,
            hasHindiScript: false,
            status: 'NOT_FOUND',
            cachedAt: Date.now(),
            expiresAt: Date.now() + NOT_FOUND_TTL_MS,
            engineVersion: res.headers.get('x-lyrics-engine-version') || CLIENT_ENGINE_VERSION,
            synced: false,
          };
          if (getGeneration(inFlightKey) === requestGeneration) {
            setCachedLyrics(notFoundEntry, params.title, params.artist);
          }
          return notFoundEntry;
        }

        // All other non-ok HTTP statuses (500, 502, 503, 504, 429, 408, 403, etc.) are SERVER/NETWORK/RATE_LIMIT ERRORS - DO NOT CACHE!
        console.warn('Server or network error during lyrics fetch:', res.status);
        return {
          trackId: songId || inFlightKey,
          lines: [],
          provider: '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'ERROR',
          error: res.status >= 500 ? 'SERVER_ERROR' : `HTTP_${res.status}`,
          cachedAt: Date.now(),
          expiresAt: 0,
          synced: false,
        };
      }

      const serverEngineVersion = res.headers.get('x-lyrics-engine-version') || CLIENT_ENGINE_VERSION;
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // Malformed json response
        return {
          trackId: songId || inFlightKey,
          lines: [],
          provider: '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'ERROR',
          error: 'SERVER_ERROR',
          cachedAt: Date.now(),
          expiresAt: 0,
          synced: false,
        };
      }

      // Check if upstream returned an error payload
      if (json.status === 'ERROR' || json.error_code) {
        return {
          trackId: songId || inFlightKey,
          lines: [],
          provider: json.provider || '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'ERROR',
          error: json.error || 'SERVER_ERROR',
          cachedAt: Date.now(),
          expiresAt: 0,
          synced: false,
        };
      }

      const isFound = (json.status === 'FOUND' || json.success === true) && (json.lines?.length > 0 || json.plainText || json.plain);

      if (!isFound) {
        // Legitimate NOT_FOUND: provider searched but no lyrics exist
        const notFoundEntry: CachedLyrics = {
          trackId: songId || inFlightKey,
          recordingKey: json.identity?.recordingKey || undefined,
          lines: [],
          provider: json.provider || '',
          syncQuality: 'NONE',
          provenance: null,
          hasHindiScript: false,
          status: 'NOT_FOUND',
          cachedAt: Date.now(),
          expiresAt: Date.now() + NOT_FOUND_TTL_MS,
          engineVersion: serverEngineVersion,
          synced: false,
        };
        if (getGeneration(inFlightKey) === requestGeneration) {
          setCachedLyrics(notFoundEntry, params.title, params.artist);
        }
        return notFoundEntry;
      }

      // Parse found lyrics document
      const doc = json.data || json;
      const isSynced = Boolean(doc.syncQuality === 'LINE' || doc.syncQuality === 'WORD' || doc.syncQuality === 'DERIVED_WORD' || doc.capabilities?.lineSync);
      const hasWordTiming = Boolean(doc.syncQuality === 'WORD' || doc.syncQuality === 'DERIVED_WORD' || doc.capabilities?.wordSync);

      const isAuthenticWordSync = doc.provenance
        ? Boolean(doc.provenance.isAuthenticTiming && (doc.provenance.syncType === 'WORD' || doc.provenance.syncType === 'SYLLABLE'))
        : Boolean(doc.syncQuality === 'WORD');

      let parsedLines: ParsedLyricLine[] = [];
      let hasHindiScript = false;

      if (isSynced && Array.isArray(doc.lines) && doc.lines.length > 0) {
        parsedLines = doc.lines.map((l: any) => {
          const rawTime = (l.startMs !== undefined && l.startMs !== null) ? l.startMs / 1000 : (l.time ?? 0);
          const rawEndTime = (l.endMs !== undefined && l.endMs !== null) ? l.endMs / 1000 : (l.endTime ?? (rawTime + 3));
          const rawText = l.original || l.text || '';
          const rawWords = (isAuthenticWordSync && Array.isArray(l.words) && l.words.length > 0)
            ? l.words.map((w: any) => ({
                text: w.text,
                startTime: (w.startMs !== undefined && w.startMs !== null) ? w.startMs / 1000 : (w.startTime ?? 0),
                endTime: (w.endMs !== undefined && w.endMs !== null) ? w.endMs / 1000 : (w.endTime ?? 0),
                romanized: w.romanized,
              }))
            : [];

          return {
            time: rawTime,
            endTime: rawEndTime,
            text: rawText,
            romanized: l.romanized || (isNonLatinScript(rawText) ? romanizeMixedText(rawText) : undefined),
            words: rawWords,
            isInstrumental: Boolean(l.isInstrumental),
          };
        });

        if (doc.isDevanagari || parsedLines.some((l) => isNonLatinScript(l.text))) {
          hasHindiScript = true;
        }
      } else if (doc.lrc) {
        const parsed = parseLRC(doc.lrc);
        parsedLines = parsed.map((l) => ({
          ...l,
          words: [],
          romanized: isNonLatinScript(l.text) ? romanizeMixedText(l.text) : undefined,
        }));
        if (parsedLines.some((l) => isNonLatinScript(l.text))) {
          hasHindiScript = true;
        }
      } else if (doc.plainText || doc.plain) {
        const plainStr = doc.plainText || doc.plain;
        const plainLines = plainStr.split('\n').map((l: string) => l.trim()).filter(Boolean);
        parsedLines = plainLines.map((text: string) => ({
          time: -1,
          endTime: -1,
          text,
          romanized: isNonLatinScript(text) ? romanizeMixedText(text) : undefined,
          words: [],
          isInstrumental: false,
        }));
        if (parsedLines.some((l) => isNonLatinScript(l.text))) {
          hasHindiScript = true;
        }
      }

      const canonicalTrackKey = doc.identity?.canonicalTrackKey || json.identity?.canonicalTrackKey || undefined;
      const authoritativeRecordingKey = doc.identity?.recordingKey || json.identity?.recordingKey || undefined;

      const entry: CachedLyrics = {
        trackId: songId || canonicalTrackKey || authoritativeRecordingKey || inFlightKey,
        recordingKey: authoritativeRecordingKey,
        canonicalTrackKey,
        lines: parsedLines,
        provider: doc.source?.provider || doc.provider || 'unknown',
        syncQuality: doc.syncQuality || (isSynced ? (hasWordTiming ? 'WORD' : 'LINE') : 'NONE'),
        provenance: doc.provenance || null,
        hasHindiScript,
        status: 'FOUND',
        cachedAt: Date.now(),
        expiresAt: Date.now() + FOUND_TTL_MS,
        plainText: doc.plainText || doc.plain,
        engineVersion: serverEngineVersion,
        synced: isSynced,
        hasWordTiming,
        confidence: doc.confidence ?? doc.source?.confidence ?? 0.95,
        capabilities: doc.capabilities,
      };

      if (getGeneration(inFlightKey) !== requestGeneration) {
        return entry;
      }

      setCachedLyrics(entry, params.title, params.artist);
      return entry;
    } finally {
      // Cleanup handled by fetchPromise.finally below
    }
  })();

  inFlightRequests.set(inFlightKey, fetchPromise);
  inFlightPromiseGeneration.set(inFlightKey, requestGeneration);

  fetchPromise.finally(() => {
    if (inFlightRequests.get(inFlightKey) === fetchPromise) {
      inFlightRequests.delete(inFlightKey);
      inFlightPromiseGeneration.delete(inFlightKey);
    }
  });

  return fetchPromise;
}

/**
 * Background prefetch for current track so opening lyrics is instantaneous.
 */
export function prefetchLyrics(track: Song | null, streamUrl?: string) {
  if (!track || !track.title) return;
  if (getCachedLyrics(track.id, track.title, artistNames(track.artists, track.subtitle))) {
    return;
  }

  const run = () => {
    fetchLyricsWithCache({
      songId: track.id,
      title: track.title,
      artist: artistNames(track.artists, track.subtitle),
      album: track.album,
      subtitle: track.subtitle,
      duration: track.duration_ms ? track.duration_ms / 1000 : undefined,
      lyricsId: track.lyrics_id,
      streamUrl,
    }).catch(() => {});
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as any).requestIdleCallback(run);
  } else {
    setTimeout(run, 150);
  }
}
