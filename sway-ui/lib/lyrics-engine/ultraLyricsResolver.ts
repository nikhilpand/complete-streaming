/**
 * ultraLyricsResolver.ts
 * Master Resolution Coordinator for Ultra Lyrics Engine 2.0
 *
 * Implements competitive candidate architecture:
 * 1. Checks memory cache
 * 2. Fetches persistent backend authentic & derived records as CANDIDATES (not authorities)
 * 3. Fetches fresh candidates concurrently across all external providers
 * 4. Merges all candidates into a unified pool
 * 5. Deterministic scoring, structural validation, and tier-based selection
 * 6. Authentic timing contract: DERIVED_WORD is never marked as authentic provider timing
 */

import { createTrackIdentity } from './identity';
import { normalizeMetadata } from './normalizer';
import { validateCandidate, validateWordSyncStructure } from './validator';
import { scoreLyricsCandidate, evaluateAcceptance } from './matcher';
import { parseStrictLRC } from './parsers/lrcParser';
import { parseRichSync } from './parsers/richsyncParser';
import { enrichLinesWithRomanization } from './transliteration';
import { lyricsL1Cache, inFlightDeduplicator } from './cache';
import {
  TrackIdentity,
  LyricsCandidate,
  LyricsDocument,
  LyricsLine,
  SyncQuality,
  LyricsSyncType,
  TimingProvenanceType,
  TimingSource,
  LyricsTimingProvenance,
  MatchScoreBreakdown,
  RichSyncLine,
} from './types';

// Provider adapters
import { lrclibProvider } from './providers/lrclib';
import { ytmusicProvider } from './providers/ytmusic';
import { jioSaavnProvider } from './providers/saavn';
import { musixmatchProvider } from './providers/musixmatch';
import { biniLyricsProvider } from './providers/binilyrics';
import { unisonProvider } from './providers/unison';
import { ILyricsProvider } from './providers/base';

const PROVIDERS: ILyricsProvider[] = [
  biniLyricsProvider,
  unisonProvider,
  lrclibProvider,
  ytmusicProvider,
  jioSaavnProvider,
  musixmatchProvider,
];

export interface ResolveRequestParams {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  subtitle?: string;
  durationMs?: number;
  duration?: number; // seconds
  videoId?: string;
  isrc?: string;
  provider?: string;
  providerId?: string;
  providerTrackId?: string;
  streamUrl?: string;
}

export async function resolveLyrics(params: ResolveRequestParams): Promise<LyricsDocument> {
  const identity = createTrackIdentity(params);

  if (!identity.title) {
    return createEmptyDocument(identity);
  }

  // 1. Fast Path: Check L1 Memory Cache keyed by canonical recordingKey
  const cached = lyricsL1Cache.get(identity.recordingKey) || lyricsL1Cache.get(identity.identityHash);
  if (cached) {
    return cached;
  }

  // 2. In-Flight Request Deduplication by recordingKey
  return inFlightDeduplicator.run(identity.recordingKey, () => executeResolution(identity, params.streamUrl));
}

const BACKEND_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000') + '/api/v1';

/**
 * Fetches cached sync from persistent storage as a competing candidate.
 * The cache is NEVER an unconditional authority.
 */
async function fetchBackendCachedCandidate(identity: TrackIdentity): Promise<LyricsCandidate | null> {
  try {
    const trackParam = identity.canonicalTrackKey || identity.providerTrackId || identity.videoId || 'track';
    const res = await fetch(
      `${BACKEND_BASE}/lyrics/sync/${encodeURIComponent(trackParam)}?identity_hash=${encodeURIComponent(identity.recordingKey)}`,
      { signal: AbortSignal.timeout(600) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;

    const dbDoc = json.data;
    const isWord = dbDoc.sync_type === 'WORD';
    const isDerived = dbDoc.sync_type === 'DERIVED_WORD';
    const isLine = dbDoc.sync_type === 'LINE';

    if (!isWord && !isDerived && !isLine) {
      return null;
    }

    // Convert stored lines to RichSyncLine format if word-timed
    let candidateRichSync: RichSyncLine[] | undefined;
    if ((isWord || isDerived) && Array.isArray(dbDoc.lines) && dbDoc.lines.length > 0) {
      candidateRichSync = dbDoc.lines.map((l: any) => ({
        ts: (l.start_ms ?? 0) / 1000.0,
        te: (l.end_ms ?? (l.start_ms ?? 0) + 3000) / 1000.0,
        l: (l.words || []).map((w: any) => ({
          c: w.text + ' ',
          o: Math.max(0, (w.start_ms - (l.start_ms ?? 0)) / 1000.0),
          d: Math.max(0.04, (w.end_ms - w.start_ms) / 1000.0),
        })),
      }));
    }

    // Convert to LRC if line-synced
    let candidateLrc: string | undefined;
    if (isLine && Array.isArray(dbDoc.lines)) {
      candidateLrc = dbDoc.lines
        .map((l: any) => {
          const totalSec = (l.start_ms ?? 0) / 1000.0;
          const m = Math.floor(totalSec / 60);
          const s = Math.floor(totalSec % 60);
          const ms = Math.floor((totalSec % 1) * 100);
          return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}] ${l.original || ''}`;
        })
        .join('\n');
    }

    const timingProvenance: TimingProvenanceType = isWord
      ? 'AUTHENTIC_WORD'
      : isDerived
      ? 'DERIVED_WORD'
      : 'LINE';

    return {
      providerId: 'backend-alignment',
      providerTrackId: identity.providerTrackId,
      videoId: identity.videoId,
      title: dbDoc.title || identity.title,
      artists: dbDoc.artist ? [dbDoc.artist] : identity.artists,
      album: dbDoc.album || identity.album,
      durationMs: dbDoc.duration_ms || identity.durationMs,
      richSync: candidateRichSync,
      syncedLyrics: candidateLrc,
      plainLyrics: dbDoc.plain_text,
      instrumental: false,
      sourceReference: `cached:${dbDoc.engine_used || 'db'}`,
      providerConfidence: dbDoc.confidence || 0.90,
      fetchedAtMs: Date.now(),
      timingProvenance,
      timingConfidence: isWord ? 0.96 : isDerived ? (dbDoc.timing_confidence || 0.78) : 0.85,
      acousticConfidence: isDerived ? (dbDoc.alignment_confidence || dbDoc.confidence || 0.75) : 0.0,
    };
  } catch {
    return null;
  }
}

function triggerBackendAlignment(identity: TrackIdentity, lines: LyricsLine[], streamUrl?: string) {
  try {
    const trackParam = identity.canonicalTrackKey || identity.providerTrackId || identity.videoId || 'track';
    fetch(`${BACKEND_BASE}/lyrics/${encodeURIComponent(trackParam)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: identity.provider,
        provider_track_id: identity.providerTrackId,
        canonical_track_id: identity.canonicalTrackKey,
        title: identity.title,
        artist: identity.artists.join(', '),
        album: identity.album,
        duration_ms: identity.durationMs,
        identity_hash: identity.recordingKey,
        recording_key: identity.recordingKey,
        stream_url: streamUrl,
        lines: lines.map((l) => ({
          id: l.id,
          start_ms: l.startMs,
          end_ms: l.endMs,
          original: l.original,
          words: [],
          is_instrumental: Boolean(l.isInstrumental),
        })),
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  } catch {
    // Non-blocking fire-and-forget
  }
}

async function executeResolution(identity: TrackIdentity, streamUrl?: string): Promise<LyricsDocument> {
  const normalized = normalizeMetadata(identity);

  // 1. Concurrently fetch cached candidate and fresh provider candidates
  const cachedPromise = fetchBackendCachedCandidate(identity);
  const providerPromises = PROVIDERS.map(async (provider) => {
    try {
      const perProviderSignal = AbortSignal.timeout(3500);
      return await provider.resolveCandidates(identity, normalized, perProviderSignal);
    } catch {
      return [] as LyricsCandidate[];
    }
  });

  const [cachedResult, ...providerResults] = await Promise.allSettled([cachedPromise, ...providerPromises]);

  const allCandidates: LyricsCandidate[] = [];

  // Add backend cached candidate if found
  if (cachedResult.status === 'fulfilled' && cachedResult.value) {
    allCandidates.push(cachedResult.value);
  }

  // Add all fresh provider candidates
  for (const res of providerResults) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allCandidates.push(...res.value);
    }
  }

  if (allCandidates.length === 0) {
    const emptyDoc = createEmptyDocument(identity);
    lyricsL1Cache.set(identity.recordingKey, emptyDoc);
    return emptyDoc;
  }

  // 2. Candidate Validation & Deterministic Scoring
  const scoredCandidates: Array<{
    candidate: LyricsCandidate;
    score: MatchScoreBreakdown;
    decision: 'AUTO_ACCEPT' | 'CORROBORATED_ACCEPT' | 'FALLBACK_ONLY' | 'REJECT';
  }> = [];

  for (const cand of allCandidates) {
    const validation = validateCandidate(cand);
    const score = scoreLyricsCandidate(identity, cand, validation.isValid);
    const decision = evaluateAcceptance(score.totalScore);

    if (decision !== 'REJECT') {
      scoredCandidates.push({ candidate: cand, score, decision });
    }
  }

  if (scoredCandidates.length === 0) {
    const emptyDoc = createEmptyDocument(identity);
    lyricsL1Cache.set(identity.recordingKey, emptyDoc);
    return emptyDoc;
  }

  // 3. Select Best Candidate (Competitive Hierarchy)
  // Tier 4: Authentic word sync (Bini/Unison/Musixmatch richsync) with score >= 0.70
  // Tier 3: Derived word sync (cached audio-aligned) with score >= 0.75
  // Tier 2: Line-synced lyrics with score >= 0.65
  // Tier 1: Plain lyrics
  scoredCandidates.sort((a, b) => {
    const getSyncTier = (c: LyricsCandidate, s: MatchScoreBreakdown) => {
      const isWord = c.richSync && c.richSync.length >= 3;
      if (isWord && c.timingProvenance === 'AUTHENTIC_WORD' && s.totalScore >= 0.70) {
        return 4;
      }
      if (isWord && c.timingProvenance === 'DERIVED_WORD' && s.totalScore >= 0.75) {
        return 3;
      }
      if (isWord && s.totalScore >= 0.70) {
        return 3;
      }
      if (c.syncedLyrics && s.totalScore >= 0.65) {
        return 2;
      }
      return 1;
    };

    const tierDiff = getSyncTier(b.candidate, b.score) - getSyncTier(a.candidate, a.score);
    if (tierDiff !== 0) return tierDiff;

    const rankOrder = { AUTO_ACCEPT: 3, CORROBORATED_ACCEPT: 2, FALLBACK_ONLY: 1, REJECT: 0 };
    const decisionDiff = rankOrder[b.decision] - rankOrder[a.decision];
    if (decisionDiff !== 0) return decisionDiff;

    // Within same tier, rank by composite (match score + timing confidence)
    const compositeA = a.score.totalScore * 0.40 + (a.candidate.timingConfidence ?? 0.75) * 0.60;
    const compositeB = b.score.totalScore * 0.40 + (b.candidate.timingConfidence ?? 0.75) * 0.60;
    return compositeB - compositeA;
  });

  const winner = scoredCandidates[0];
  const bestCandidate = winner.candidate;

  // 4. Parse & Normalize Lyrics Structure
  let syncQuality: SyncQuality = 'NONE';
  let lines: LyricsLine[] = [];
  let plainText = bestCandidate.plainLyrics;
  let wordSyncValid = false;

  if (bestCandidate.richSync && bestCandidate.richSync.length > 0) {
    const parsedRich = parseRichSync(bestCandidate.richSync);
    if (parsedRich.lines.length > 0) {
      lines = parsedRich.lines;
      wordSyncValid = parsedRich.isWordSyncValid;
      if (wordSyncValid) {
        syncQuality = bestCandidate.timingProvenance === 'DERIVED_WORD' ? 'DERIVED_WORD' : 'WORD';
      } else {
        syncQuality = 'LINE';
      }
      if (!plainText) {
        plainText = lines.map((l) => l.original).join('\n');
      }
    }
  } else if (bestCandidate.syncedLyrics) {
    lines = parseStrictLRC(bestCandidate.syncedLyrics, identity.durationMs);
    syncQuality = 'LINE';
    if (!plainText) {
      plainText = lines.map((l) => l.original).join('\n');
    }
  } else if (bestCandidate.plainLyrics) {
    const rawPlainLines = bestCandidate.plainLyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines = rawPlainLines.map((text, idx) => ({
      id: idx,
      startMs: null,
      endMs: null,
      original: text,
      words: [],
      isInstrumental: text === '♪' || /^(?:\[|\()?instrumental(?:\]|\))?$/i.test(text),
    }));
    syncQuality = 'NONE';
  }

  // 5. Script Detection & Transliteration
  const translitResult = enrichLinesWithRomanization(lines);

  // 6. Build Detailed Provenance with Strict Authenticity Contract
  let syncType: LyricsSyncType = 'NONE';
  let hasSyllableTiming = false;
  if (bestCandidate.richSync && bestCandidate.richSync.length > 0) {
    hasSyllableTiming = bestCandidate.richSync.some((line) => line.l?.some((w) => typeof w.d === 'number' && w.d > 0));
  }

  if (syncQuality === 'WORD' || syncQuality === 'DERIVED_WORD') {
    syncType = hasSyllableTiming ? 'SYLLABLE' : 'WORD';
  } else if (syncQuality === 'LINE') {
    syncType = 'LINE';
  } else {
    syncType = 'NONE';
  }

  const timingSourceMap: Record<string, TimingSource> = {
    binilyrics: 'bini',
    unison: 'unison',
    musixmatch: 'musixmatch',
    lrclib: 'lrclib',
    jiosaavn: 'saavn',
    'backend-alignment': 'backend-alignment',
    alignment_worker: 'backend-alignment',
  };
  const timingSource: TimingSource = timingSourceMap[bestCandidate.providerId] || 'unknown';

  let timingProvenance: TimingProvenanceType = 'PLAIN';
  if (syncQuality === 'WORD' && wordSyncValid) {
    timingProvenance = 'AUTHENTIC_WORD';
  } else if (syncQuality === 'DERIVED_WORD' && wordSyncValid) {
    timingProvenance = 'DERIVED_WORD';
  } else if (syncQuality === 'LINE') {
    timingProvenance = 'LINE';
  }

  // Section 3 Critical Invariant:
  // isAuthenticTiming is true ONLY for genuine provider word timing.
  // DERIVED_WORD from Whisper is NEVER flagged as authentic provider timing.
  const isAuthenticTiming = timingProvenance === 'AUTHENTIC_WORD' && winner.score.totalScore >= 0.70;

  const matchConfidence = winner.score.totalScore;
  const timingConfidence = bestCandidate.timingConfidence ?? (syncQuality === 'WORD' ? 0.95 : syncQuality === 'LINE' ? 0.85 : 0.0);
  const acousticConfidence = bestCandidate.acousticConfidence ?? 0.0;
  const overallConfidence = Number((matchConfidence * 0.40 + timingConfidence * 0.60).toFixed(3));

  const provenance: LyricsTimingProvenance = {
    syncType,
    timingProvenance,
    timingSource,
    isAuthenticTiming,
    matchConfidence,
    timingConfidence,
    acousticConfidence,
    overallConfidence,
    confidence: overallConfidence,
  };

  const doc: LyricsDocument = {
    status: 'FOUND',
    identity: {
      title: identity.title,
      artist: identity.artists.join(', '),
      album: identity.album,
      durationMs: identity.durationMs,
      version: identity.version,
      recordingKey: identity.recordingKey,
      canonicalTrackKey: identity.canonicalTrackKey,
    },
    source: {
      provider: bestCandidate.providerId,
      confidence: overallConfidence,
      providerTrackId: bestCandidate.providerTrackId,
      sourceReference: bestCandidate.sourceReference,
    },
    syncQuality,
    provenance,
    lines: translitResult.lines,
    plainText,
    capabilities: {
      plain: Boolean(plainText),
      lineSync: syncQuality === 'LINE' || syncQuality === 'WORD' || syncQuality === 'DERIVED_WORD',
      wordSync: syncQuality === 'WORD' || syncQuality === 'DERIVED_WORD',
      romanized: translitResult.hasRomanizedContent,
    },
    confidence: overallConfidence,
    cachedAtMs: Date.now(),
  };

  // If we only have LINE-level sync, trigger asynchronous word alignment in background
  if (syncQuality === 'LINE' && lines.length > 0 && bestCandidate.providerId !== 'backend-alignment') {
    triggerBackendAlignment(identity, lines, streamUrl);
  }

  // 7. Store in L1 Cache
  lyricsL1Cache.set(identity.recordingKey, doc);
  lyricsL1Cache.set(identity.identityHash, doc);
  return doc;
}

function createEmptyDocument(identity: TrackIdentity): LyricsDocument {
  return {
    status: 'NOT_FOUND',
    identity: {
      title: identity.title,
      artist: identity.artists.join(', '),
      album: identity.album,
      durationMs: identity.durationMs,
      version: identity.version,
      recordingKey: identity.recordingKey,
      canonicalTrackKey: identity.canonicalTrackKey,
    },
    source: {
      provider: 'fallback',
      confidence: 0.0,
    },
    syncQuality: 'NONE',
    provenance: {
      syncType: 'NONE',
      timingProvenance: 'PLAIN',
      timingSource: 'unknown',
      isAuthenticTiming: false,
      matchConfidence: 0.0,
      timingConfidence: 0.0,
      acousticConfidence: 0.0,
      overallConfidence: 0.0,
      confidence: 0.0,
    },
    lines: [],
    capabilities: {
      plain: false,
      lineSync: false,
      wordSync: false,
      romanized: false,
    },
    confidence: 0.0,
  };
}
