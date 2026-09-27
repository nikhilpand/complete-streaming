'use client';

import { parseLRC, type ParsedLyricLine } from '@/lib/lyric-parser';
import { isDevanagari, devanagariToRoman } from '@/lib/transliteration';
import { fetchLyrics, type LyricsResponse } from '@/lib/api';
import { artistNames } from '@/lib/utils';
import type { Song } from '@/lib/api/types';
import type { LyricsTimingProvenance } from '@/lib/lyrics-engine/types';

export interface CachedLyrics {
  trackId: string;
  lines: ParsedLyricLine[];
  provider: string;
  syncQuality: string;
  provenance: LyricsTimingProvenance | null;
  hasHindiScript: boolean;
  status: 'FOUND' | 'NOT_FOUND';
  cachedAt: number;
}

// In-memory cache keyed by track ID and normalized `${title}::${artist}`
const lyricsMemoryCache = new Map<string, CachedLyrics>();
// Deduplication map for in-flight fetch promises to prevent parallel duplicate network calls
const inFlightRequests = new Map<string, Promise<CachedLyrics | null>>();

function makeCacheKeys(trackId?: string, title?: string, artist?: string): string[] {
  const keys: string[] = [];
  if (trackId && trackId.trim()) keys.push(trackId.trim());
  if (title && title.trim()) {
    const cleanTitle = title.toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').replace(/[^\w\s]/g, '').trim();
    const cleanArtist = (artist || '').toLowerCase().split(/[,·•|&]/)[0].replace(/[^\w\s]/g, '').trim();
    if (cleanTitle) {
      keys.push(`${cleanTitle}::${cleanArtist}`);
    }
  }
  return keys;
}

export function getCachedLyrics(trackId?: string, title?: string, artist?: string): CachedLyrics | null {
  const keys = makeCacheKeys(trackId, title, artist);
  for (const k of keys) {
    const entry = lyricsMemoryCache.get(k);
    if (entry) return entry;
  }
  return null;
}

export function setCachedLyrics(
  trackId: string,
  data: Omit<CachedLyrics, 'cachedAt' | 'trackId'>,
  title?: string,
  artist?: string
) {
  const entry: CachedLyrics = {
    ...data,
    trackId,
    cachedAt: Date.now(),
  };
  const keys = makeCacheKeys(trackId, title, artist);
  for (const k of keys) {
    lyricsMemoryCache.set(k, entry);
  }
  // Keep cache bounded to 100 recent songs
  if (lyricsMemoryCache.size > 200) {
    const firstKey = lyricsMemoryCache.keys().next().value;
    if (firstKey) lyricsMemoryCache.delete(firstKey);
  }
}

/**
 * Normalizes raw Ultra Lyrics API response into client-ready parsed lines.
 */
export function parseLyricsResponse(data: LyricsResponse): Omit<CachedLyrics, 'cachedAt' | 'trackId'> {
  let provider = data.provider || '';
  let syncQuality = data.syncQuality || 'LINE';
  let provenance = data.provenance || null;
  let hasHindiScript = false;
  let parsedLines: ParsedLyricLine[] = [];
  let status: 'FOUND' | 'NOT_FOUND' = (data.status === 'NOT_FOUND' || (!data.synced && !data.plain && (!data.lines || data.lines.length === 0))) ? 'NOT_FOUND' : 'FOUND';

  const isAuthenticWordSync = data.provenance
    ? (data.provenance.isAuthenticTiming && (data.provenance.syncType === 'WORD' || data.provenance.syncType === 'SYLLABLE'))
    : (data.syncQuality === 'WORD');

  if (data.synced && data.lines && data.lines.length > 0) {
    parsedLines = data.lines.map((l: any) => {
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
        romanized: l.romanized || (isDevanagari(rawText) ? devanagariToRoman(rawText) : undefined),
        words: rawWords,
        isInstrumental: Boolean(l.isInstrumental),
      };
    });

    if (data.isDevanagari || parsedLines.some(l => isDevanagari(l.text))) {
      hasHindiScript = true;
    }
  } else if (data.synced && data.lrc) {
    const parsed = parseLRC(data.lrc);
    parsedLines = parsed.map((l) => ({
      ...l,
      words: [],
      romanized: isDevanagari(l.text) ? devanagariToRoman(l.text) : undefined,
    }));
    if (parsedLines.some(l => isDevanagari(l.text))) {
      hasHindiScript = true;
    }
    if (parsedLines.length === 0 && !data.plain) {
      status = 'NOT_FOUND';
    }
  } else if (data.plain || (data.lines && data.lines.length > 0)) {
    syncQuality = 'NONE';
    provenance = {
      syncType: 'NONE',
      timingProvenance: 'PLAIN',
      timingSource: 'unknown',
      isAuthenticTiming: false,
      matchConfidence: 0,
      timingConfidence: 0,
      acousticConfidence: 0,
      overallConfidence: 0,
      confidence: 0,
    };
    const plainLines: string[] = data.plain
      ? data.plain.split('\n').map((l: string) => l.trim()).filter(Boolean)
      : (data.lines || []).map((l: any) => (l.original || l.text || '').trim()).filter(Boolean);

    parsedLines = plainLines.map((text: string) => ({
      time: -1,
      endTime: -1,
      text,
      romanized: isDevanagari(text) ? devanagariToRoman(text) : undefined,
      words: [],
      isInstrumental: false,
    }));
    if (parsedLines.some(l => isDevanagari(l.text))) {
      hasHindiScript = true;
    }
  } else {
    status = 'NOT_FOUND';
  }

  return {
    lines: parsedLines,
    provider,
    syncQuality,
    provenance,
    hasHindiScript,
    status,
  };
}

/**
 * Fetches lyrics with in-memory caching and in-flight deduplication.
 * If already cached, returns instantly.
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
  const cached = getCachedLyrics(params.songId, params.title, params.artist);
  if (cached) {
    return cached;
  }

  const primaryKey = params.songId || `${params.title}::${params.artist || ''}`;
  const existingPromise = inFlightRequests.get(primaryKey);
  if (existingPromise) {
    const res = await existingPromise;
    if (res) return res;
  }

  const fetchPromise = (async () => {
    try {
      const data = await fetchLyrics(
        params.songId,
        params.title,
        params.artist,
        params.album,
        params.subtitle,
        params.duration,
        params.lyricsId,
        params.streamUrl
      );

      const parsed = parseLyricsResponse(data);
      const entry: CachedLyrics = {
        ...parsed,
        trackId: params.songId || primaryKey,
        cachedAt: Date.now(),
      };

      setCachedLyrics(entry.trackId, parsed, params.title, params.artist);
      return entry;
    } catch {
      const notFoundEntry: CachedLyrics = {
        trackId: params.songId || primaryKey,
        lines: [],
        provider: '',
        syncQuality: 'NONE',
        provenance: null,
        hasHindiScript: false,
        status: 'NOT_FOUND',
        cachedAt: Date.now(),
      };
      setCachedLyrics(notFoundEntry.trackId, notFoundEntry, params.title, params.artist);
      return notFoundEntry;
    } finally {
      inFlightRequests.delete(primaryKey);
    }
  })();

  inFlightRequests.set(primaryKey, fetchPromise);
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
