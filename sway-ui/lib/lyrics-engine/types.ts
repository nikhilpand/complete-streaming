/**
 * types.ts
 * Core types for Ultra Lyrics Engine 2.0 (Research-Backed Architecture)
 */

export type TrackVersion =
  | 'original'
  | 'remix'
  | 'live'
  | 'acoustic'
  | 'slowed'
  | 'sped-up'
  | 'instrumental'
  | 'karaoke'
  | 'cover'
  | 'radio-edit'
  | 'movie-version'
  | 'unspecified';

export interface TrackIdentity {
  title: string;
  artists: string[];
  album?: string;
  durationMs: number;
  videoId?: string;
  isrc?: string;
  providerId?: string;
  providerTrackId?: string;
  version: TrackVersion;
  identityHash: string;
}

export type SyncQuality = 'NONE' | 'LINE' | 'WORD' | 'DERIVED_WORD';

export interface LyricsWord {
  text: string;
  startMs: number;
  endMs: number;
  romanized?: string;
}

export interface LyricsLine {
  id: number;
  startMs: number | null;
  endMs: number | null;
  original: string;
  romanized?: string;
  words: LyricsWord[];
  isInstrumental?: boolean;
}

export interface LyricsCapabilities {
  plain: boolean;
  lineSync: boolean;
  wordSync: boolean;
  romanized: boolean;
}

export interface LyricsSource {
  provider: 'lrclib' | 'ytmusic' | 'musixmatch' | 'jiosaavn' | 'alignment_worker' | 'fallback' | string;
  confidence: number;
  providerTrackId?: string;
  sourceReference?: string;
}

export interface LyricsDocument {
  status: 'FOUND' | 'NOT_FOUND';
  identity: {
    title: string;
    artist: string;
    album?: string;
    durationMs: number;
    version: TrackVersion;
  };
  source: LyricsSource;
  syncQuality: SyncQuality;
  lines: LyricsLine[];
  plainText?: string;
  capabilities: LyricsCapabilities;
  confidence: number;
  cachedAtMs?: number;
}

export interface RichSyncWord {
  c: string; // character / word text
  o: number; // offset in seconds from line start
}

export interface RichSyncLine {
  ts: number; // line start in seconds
  te: number; // line end in seconds
  l: RichSyncWord[];
}

export interface LyricsCandidate {
  providerId: 'lrclib' | 'ytmusic' | 'musixmatch' | 'jiosaavn' | 'binilyrics' | 'unison' | string;
  providerTrackId?: string;
  title?: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  plainLyrics?: string;
  syncedLyrics?: string;
  richSync?: RichSyncLine[];
  instrumental: boolean;
  sourceReference?: string;
  providerConfidence?: number;
  fetchedAtMs: number;
}

export interface MatchScoreBreakdown {
  titleScore: number;       // weight: 0.30
  artistScore: number;      // weight: 0.30
  durationScore: number;    // weight: 0.15
  versionScore: number;     // weight: 0.10
  providerBonus: number;    // weight: 0.10
  contentSanityScore: number;// weight: 0.05
  totalScore: number;       // 0.00 to 1.00
  versionPenaltyApplied: boolean;
  rejectionReason?: string;
}

export type FailureClass =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'CAPTCHA'
  | 'AUTH_FAILURE'
  | 'NOT_FOUND'
  | 'BAD_MATCH'
  | 'MALFORMED_RESPONSE'
  | 'SERVER_ERROR'
  | 'NETWORK';

export interface ProviderHealth {
  providerId: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  malformedCount: number;
  averageLatencyMs: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  isCircuitOpen: boolean;
  circuitCooldownUntil?: number;
}
