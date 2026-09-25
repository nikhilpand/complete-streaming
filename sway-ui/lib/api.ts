/**
 * api.ts - Shared API utilities and lyrics resolution
 */

import { artUrl } from './utils';
import type { LyricsTimingProvenance } from './lyrics-engine/types';

export function getProxiedImageUrl(url?: string, width = 500, height = 500): string {
  if (!url) return '';
  return artUrl(url);
}

export interface LyricsResponse {
  status?: 'FOUND' | 'NOT_FOUND';
  synced: boolean;
  syncQuality?: 'NONE' | 'LINE' | 'WORD' | 'DERIVED_WORD';
  provenance?: LyricsTimingProvenance;
  provider?: string;
  confidence?: number;
  hasWordTiming?: boolean;
  lrc?: string;
  plain?: string;
  language?: string;
  isDevanagari?: boolean;
  capabilities?: {
    plain: boolean;
    lineSync: boolean;
    wordSync: boolean;
    romanized: boolean;
  };
  lines?: Array<{
    time: number;
    endTime: number;
    text: string;
    romanized?: string;
    words: Array<{ text: string; startTime: number; endTime: number; romanized?: string }>;
    isInstrumental?: boolean;
  }>;
}

/**
 * Intelligent Ultra Lyrics Resolver client (Section 32 Frontend Contract)
 * Connects to /api/lyrics/resolve for unified multi-tier resolution.
 */
export async function fetchLyrics(
  videoId?: string,
  title?: string,
  artist?: string,
  album?: string,
  subtitle?: string,
  duration?: number,
  lyricsId?: string
): Promise<LyricsResponse> {
  if (!title || !title.trim()) return { synced: false, status: 'NOT_FOUND' };

  // 1. Primary: Call Ultra Lyrics Engine API route
  try {
    const params = new URLSearchParams({
      title: title.trim(),
    });
    if (artist) params.set('artist', artist.trim());
    if (album) params.set('album', album.trim());
    if (subtitle) params.set('subtitle', subtitle.trim());
    if (duration && duration > 0) params.set('duration', duration.toString());
    if (videoId) params.set('songId', videoId);
    if (lyricsId) params.set('lyricsId', lyricsId);

    const res = await fetch(`/api/lyrics/resolve?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const isFound = json.status === 'FOUND' || json.success;
      const doc = json.data || json;

      if (isFound && doc) {
        const isSynced = doc.syncQuality === 'LINE' || doc.syncQuality === 'WORD' || doc.capabilities?.lineSync;
        const hasWordTiming = doc.syncQuality === 'WORD' || doc.capabilities?.wordSync;

        // Map lines to time / endTime in seconds for lyric rendering stage
        const mappedLines = (isSynced && Array.isArray(doc.lines))
          ? doc.lines.map((l: any) => ({
              time: l.startMs !== null && l.startMs !== undefined ? l.startMs / 1000 : (l.time ?? 0),
              endTime: l.endMs !== null && l.endMs !== undefined ? l.endMs / 1000 : (l.endTime ?? 0),
              text: l.original || l.text || '',
              romanized: l.romanized,
              words: Array.isArray(l.words)
                ? l.words.map((w: any) => ({
                    text: w.text,
                    startTime: w.startMs !== null && w.startMs !== undefined ? w.startMs / 1000 : (w.startTime ?? 0),
                    endTime: w.endMs !== null && w.endMs !== undefined ? w.endMs / 1000 : (w.endTime ?? 0),
                    romanized: w.romanized,
                  }))
                : [],
              isInstrumental: Boolean(l.isInstrumental),
            }))
          : undefined;

        return {
          status: 'FOUND',
          synced: isSynced,
          syncQuality: doc.syncQuality || (isSynced ? (hasWordTiming ? 'WORD' : 'LINE') : 'NONE'),
          provenance: doc.provenance || {
            syncType: isSynced ? (hasWordTiming ? 'WORD' : 'LINE') : 'NONE',
            timingSource: (doc.source?.provider || doc.provider || 'unknown') as any,
            isAuthenticTiming: Boolean(hasWordTiming || (isSynced && mappedLines && mappedLines.length > 0)),
            confidence: doc.confidence || doc.source?.confidence || 0.95,
          },
          hasWordTiming,
          provider: doc.source?.provider || doc.provider || 'lrclib',
          confidence: doc.confidence || doc.source?.confidence || 0.95,
          isDevanagari: doc.capabilities?.romanized || mappedLines?.some((l: any) => /[\u0900-\u097F]/.test(l.text)),
          capabilities: doc.capabilities,
          plain: doc.plainText || doc.plain,
          lines: mappedLines,
        };
      }
    }
  } catch (e) {
    console.warn('UltraLyrics API fetch failed, falling back to direct client search', e);
  }

  // 2. Direct client fallback to LRCLIB if server route is unavailable
  const rawTitle = title.trim();
  const cleanTitle = rawTitle.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s*-\s*.*/, '').trim() || rawTitle;
  const primaryArtist = (artist || '').split(/[,&/|]/)[0].trim();

  try {
    const q = primaryArtist ? `${cleanTitle} ${primaryArtist}` : cleanTitle;
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Lrclib-Client': 'SwayMusic/2.0' },
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const syncedItem = list.find((item: any) => item.syncedLyrics);
        if (syncedItem) {
          return {
            status: 'FOUND',
            synced: true,
            syncQuality: 'LINE',
            provenance: {
              syncType: 'LINE',
              timingSource: 'lrclib',
              isAuthenticTiming: true,
              confidence: 0.85,
            },
            lrc: syncedItem.syncedLyrics,
            provider: 'lrclib',
            confidence: 0.85,
          };
        }
        const plainItem = list.find((item: any) => item.plainLyrics);
        if (plainItem) {
          return {
            status: 'FOUND',
            synced: false,
            syncQuality: 'NONE',
            provenance: {
              syncType: 'NONE',
              timingSource: 'lrclib',
              isAuthenticTiming: false,
              confidence: 0.80,
            },
            plain: plainItem.plainLyrics,
            provider: 'lrclib',
            confidence: 0.80,
          };
        }
      }
    }
  } catch (_) {}

  return {
    synced: false,
    status: 'NOT_FOUND',
    provenance: {
      syncType: 'NONE',
      timingSource: 'unknown',
      isAuthenticTiming: false,
      confidence: 0,
    },
  };
}
