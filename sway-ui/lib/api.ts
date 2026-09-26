/**
 * api.ts - Shared API utilities and lyrics resolution
 */

import { artUrl } from './utils';
import type { LyricsTimingProvenance, LyricsSyncType, SyncQuality } from './lyrics-engine/types';

export function getProxiedImageUrl(url?: string, width = 500, height = 500): string {
  if (!url) return '';
  return artUrl(url);
}

export interface LyricsResponse {
  status?: 'FOUND' | 'NOT_FOUND';
  synced: boolean;
  syncQuality?: SyncQuality;
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
 * Connects exclusively to /api/lyrics/resolve for unified multi-tier resolution.
 * All candidate ranking, validation, identity matching, and alignment logic is
 * centralized inside the Ultra Lyrics Engine.
 */
export async function fetchLyrics(
  videoId?: string,
  title?: string,
  artist?: string,
  album?: string,
  subtitle?: string,
  duration?: number,
  lyricsId?: string,
  streamUrl?: string
): Promise<LyricsResponse> {
  if (!title || !title.trim()) return { synced: false, status: 'NOT_FOUND' };

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
    if (streamUrl) params.set('stream_url', streamUrl);

    const res = await fetch(`/api/lyrics/resolve?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const isFound = json.status === 'FOUND' || json.success;
      const doc = json.data || json;

      if (isFound && doc) {
        const isSynced = doc.syncQuality === 'LINE' || doc.syncQuality === 'WORD' || doc.syncQuality === 'DERIVED_WORD' || doc.capabilities?.lineSync;
        const hasWordTiming = doc.syncQuality === 'WORD' || doc.syncQuality === 'DERIVED_WORD' || doc.capabilities?.wordSync;

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
          provenance: doc.provenance,
          hasWordTiming,
          provider: doc.source?.provider || doc.provider || 'unknown',
          confidence: doc.confidence || doc.source?.confidence || 0.95,
          isDevanagari: doc.capabilities?.romanized || mappedLines?.some((l: any) => /[\u0900-\u097F]/.test(l.text)),
          capabilities: doc.capabilities,
          plain: doc.plainText || doc.plain,
          lines: mappedLines,
        };
      }
    }
  } catch (e) {
    console.warn('UltraLyrics canonical resolver fetch failed:', e);
  }

  // Clean failure / not-found state without bypassing engine
  return {
    synced: false,
    status: 'NOT_FOUND',
    syncQuality: 'NONE',
    provenance: {
      syncType: 'NONE',
      timingProvenance: 'PLAIN',
      timingSource: 'unknown',
      isAuthenticTiming: false,
      matchConfidence: 0,
      timingConfidence: 0,
      acousticConfidence: 0,
      overallConfidence: 0,
      confidence: 0,
    },
  };
}
