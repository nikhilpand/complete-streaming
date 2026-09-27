/**
 * api.ts - Shared API utilities and lyrics resolution
 */

import { artUrl } from './utils';
import type { LyricsTimingProvenance, SyncQuality } from './lyrics-engine/types';
import { fetchLyricsWithCache, type CachedLyrics } from './lyricsCache';

export function getProxiedImageUrl(url?: string, width = 500, height = 500): string {
  if (!url) return '';
  return artUrl(url);
}

export interface LyricsResponse {
  status?: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  synced: boolean;
  syncQuality?: SyncQuality | string;
  provenance?: LyricsTimingProvenance | null;
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
  error?: string;
}

/**
 * Intelligent Ultra Lyrics Resolver client (Section 32 Frontend Contract)
 * Connects exclusively to the authoritative client lyrics cache and resolver.
 * All caching, TTL, negative-caching, and in-flight deduplication are unified in lyricsCache.
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
  const result: CachedLyrics = await fetchLyricsWithCache({
    songId: videoId,
    title: title || '',
    artist,
    album,
    subtitle,
    duration,
    lyricsId,
    streamUrl,
  });

  return {
    status: result.status,
    error: result.error,
    synced: result.synced,
    syncQuality: result.syncQuality,
    provenance: result.provenance,
    provider: result.provider,
    confidence: result.confidence,
    hasWordTiming: result.hasWordTiming,
    isDevanagari: result.hasHindiScript,
    capabilities: result.capabilities,
    plain: result.plainText,
    lines: result.lines,
  };
}
