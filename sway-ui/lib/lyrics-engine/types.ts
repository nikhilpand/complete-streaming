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
  provider: string; // e.g. "youtube", "saavn", "lrclib", "unknown"
  providerId?: string; // backward compat alias
  providerTrackId?: string;
  videoId?: string;
  isrc?: string;
  canonicalTrackKey: string; // e.g. "youtube:VIDEO_ID" or "saavn:PID"
  title: string;
  normalizedTitle: string;
  artists: string[];
  normalizedArtists: string[];
  album?: string;
  normalizedAlbum?: string;
  durationMs: number;
  exactDurationBucket: number; // 1-second exact bucket: Math.floor(durationMs / 1000)
  version: TrackVersion;
  recordingKey: string; // SHA-256 fingerprint
  identityHash: string; // alias for recordingKey
}

export type SyncQuality = 'NONE' | 'LINE' | 'WORD' | 'DERIVED_WORD';

export type LyricsSyncType = 'NONE' | 'LINE' | 'WORD' | 'SYLLABLE';

export type TimingProvenanceType = 'AUTHENTIC_WORD' | 'DERIVED_WORD' | 'LINE' | 'PLAIN';

export type WordTimingType = 'ACOUSTIC_ANCHOR' | 'INTERPOLATED' | 'UNCERTAIN';

export type TimingSource =
  | 'bini'
  | 'unison'
  | 'musixmatch'
  | 'backend-alignment'
  | 'lrclib'
  | 'saavn'
  | 'fallback'
  | 'unknown';

export interface LyricsTimingProvenance {
  syncType: LyricsSyncType;
  timingProvenance: TimingProvenanceType;
  timingSource: TimingSource;
  isAuthenticTiming: boolean;
  matchConfidence: number;
  timingConfidence: number;
  acousticConfidence: number;
  overallConfidence: number;
  confidence: number; // backward compatibility alias for overallConfidence
}

export interface LyricsWord {
  text: string;
  startMs: number;
  endMs: number;
  romanized?: string;
  timingType?: WordTimingType;
  confidence?: number;
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
    recordingKey?: string;
    canonicalTrackKey?: string;
  };
  source: LyricsSource;
  syncQuality: SyncQuality;
  provenance?: LyricsTimingProvenance;
  lines: LyricsLine[];
  plainText?: string;
  capabilities: LyricsCapabilities;
  confidence: number;
  cachedAtMs?: number;
}

export interface RichSyncWord {
  c: string; // character / word text
  o: number; // offset in seconds from line start
  d?: number; // duration in seconds
}

export interface RichSyncLine {
  ts: number; // line start in seconds
  te: number; // line end in seconds
  l: RichSyncWord[];
}

export interface LyricsCandidate {
  providerId: 'lrclib' | 'ytmusic' | 'musixmatch' | 'jiosaavn' | 'binilyrics' | 'unison' | string;
  providerTrackId?: string;
  videoId?: string;
  isrc?: string;
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
  timingProvenance?: TimingProvenanceType;
  timingConfidence?: number;
  acousticConfidence?: number;
}

export interface MatchScoreBreakdown {
  recordingMatchScore: number; // weight: 0.20 (exact ISRC, providerTrackId, exact duration match)
  titleScore: number;          // weight: 0.25 (title similarity)
  artistScore: number;         // weight: 0.25 (artist similarity)
  durationScore: number;       // weight: 0.15 (duration similarity)
  versionScore: number;        // weight: 0.10 (studio vs live vs remix vs instrumental)
  providerBonus: number;       // weight: 0.02 (secondary tie-breaker only)
  contentSanityScore: number;  // weight: 0.03 (structural content sanity)
  totalScore: number;          // 0.00 to 1.00
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
