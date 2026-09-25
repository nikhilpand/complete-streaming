/**
 * ultraLyricsResolver.ts
 * Master Resolution Coordinator for Ultra Lyrics Engine 2.0 (Sections 1, 7, 9, 10, 12, 13, 14, 29)
 */

import { createTrackIdentity } from './identity';
import { normalizeMetadata } from './normalizer';
import { validateCandidate } from './validator';
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
  MatchScoreBreakdown,
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
  providerId?: string;
  providerTrackId?: string;
}

export async function resolveLyrics(params: ResolveRequestParams): Promise<LyricsDocument> {
  const identity = createTrackIdentity(params);

  if (!identity.title) {
    return createEmptyDocument(identity);
  }

  // 1. Fast Path: Check L1 Memory Cache (Section 18 & 30)
  const cached = lyricsL1Cache.get(identity.identityHash);
  if (cached) {
    return cached;
  }

  // 2. In-Flight Request Deduplication (Section 20)
  return inFlightDeduplicator.run(identity.identityHash, () => executeResolution(identity));
}

const BACKEND_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000') + '/api/v1';

async function fetchBackendSynchronizedLyrics(identity: TrackIdentity): Promise<LyricsDocument | null> {
  try {
    const trackId = identity.providerTrackId || identity.videoId || 'track';
    const res = await fetch(
      `${BACKEND_BASE}/lyrics/sync/${encodeURIComponent(trackId)}?identity_hash=${encodeURIComponent(identity.identityHash)}`,
      { signal: AbortSignal.timeout(600) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.data) return null;

    const dbDoc = data.data;
    if (dbDoc.sync_type !== 'WORD' && dbDoc.sync_type !== 'DERIVED_WORD') {
      return null;
    }

    const lines: LyricsLine[] = (dbDoc.lines || []).map((l: any, idx: number) => ({
      id: l.id ?? idx,
      startMs: l.start_ms,
      endMs: l.end_ms,
      original: l.original,
      romanized: l.romanized,
      isInstrumental: Boolean(l.is_instrumental),
      words: (l.words || []).map((w: any) => ({
        text: w.text,
        startMs: w.start_ms,
        endMs: w.end_ms,
      })),
    }));

    const translitResult = enrichLinesWithRomanization(lines);

    return {
      status: 'FOUND',
      identity: {
        title: dbDoc.title || identity.title,
        artist: dbDoc.artist || identity.artists.join(', '),
        album: dbDoc.album || identity.album,
        durationMs: dbDoc.duration_ms || identity.durationMs,
        version: identity.version,
      },
      source: {
        provider: dbDoc.source_provider || 'alignment_worker',
        confidence: dbDoc.confidence || 0.95,
        sourceReference: dbDoc.engine_used,
      },
      syncQuality: dbDoc.sync_type === 'DERIVED_WORD' ? 'DERIVED_WORD' : 'WORD',
      lines: translitResult.lines,
      plainText: dbDoc.plain_text,
      capabilities: {
        plain: Boolean(dbDoc.plain_text),
        lineSync: true,
        wordSync: true,
        romanized: translitResult.hasRomanizedContent,
      },
      confidence: dbDoc.confidence || 0.95,
      cachedAtMs: Date.now(),
    };
  } catch {
    return null;
  }
}

function triggerBackendAlignment(identity: TrackIdentity, lines: LyricsLine[]) {
  try {
    const trackId = identity.providerTrackId || identity.videoId || 'track';
    fetch(`${BACKEND_BASE}/lyrics/${encodeURIComponent(trackId)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: identity.title,
        artist: identity.artists.join(', '),
        album: identity.album,
        duration_ms: identity.durationMs,
        identity_hash: identity.identityHash,
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

async function executeResolution(identity: TrackIdentity): Promise<LyricsDocument> {
  // 2.5 Check Persistent Database Cache for high-quality WORD or DERIVED_WORD sync
  const persistentDoc = await fetchBackendSynchronizedLyrics(identity);
  if (persistentDoc) {
    lyricsL1Cache.set(identity.identityHash, persistentDoc);
    return persistentDoc;
  }

  const normalized = normalizeMetadata(identity);

  // 3. Parallel Provider Resolution with Isolated Timeouts (Section 7)
  const providerPromises = PROVIDERS.map(async (provider) => {
    try {
      const perProviderSignal = AbortSignal.timeout(3000);
      return await provider.resolveCandidates(identity, normalized, perProviderSignal);
    } catch {
      return [] as LyricsCandidate[];
    }
  });

  const candidateArrays = await Promise.allSettled(providerPromises);

  console.log('Provider results:', candidateArrays.map((r, i) => ({
    provider: PROVIDERS[i]?.providerId,
    status: r.status,
    count: r.status === 'fulfilled' ? r.value?.length : 0,
    error: r.status === 'rejected' ? (r as any).reason?.message : undefined,
  })));

  const allCandidates: LyricsCandidate[] = [];
  for (const res of candidateArrays) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allCandidates.push(...res.value);
    }
  }

  if (allCandidates.length === 0) {
    const emptyDoc = createEmptyDocument(identity);
    lyricsL1Cache.set(identity.identityHash, emptyDoc);
    return emptyDoc;
  }

  // 4. Candidate Validation & Deterministic Scoring (Sections 9, 10 & 11)
  const scoredCandidates: Array<{
    candidate: LyricsCandidate;
    score: MatchScoreBreakdown;
    decision: 'AUTO_ACCEPT' | 'CORROBORATED_ACCEPT' | 'FALLBACK_ONLY' | 'REJECT';
  }> = [];

  for (const cand of allCandidates) {
    const validation = validateCandidate(cand);
    const score = scoreLyricsCandidate(identity, cand, validation.isValid);
    const decision = evaluateAcceptance(score.totalScore);

    console.log(`[Candidate Score] Provider=${cand.providerId} Title="${cand.title}" Total=${score.totalScore} Decision=${decision} Valid=${validation.isValid} Reason=${validation.reason || score.rejectionReason || 'ok'}`);

    if (decision !== 'REJECT') {
      scoredCandidates.push({ candidate: cand, score, decision });
    }
  }

  if (scoredCandidates.length === 0) {
    const emptyDoc = createEmptyDocument(identity);
    lyricsL1Cache.set(identity.identityHash, emptyDoc);
    return emptyDoc;
  }

  // 5. Select Best Candidate (Section 1 & 9)
  // Tie-breaker:
  // Preference 1: Genuine WORD sync (richsync) with valid corroboration (>= 0.70) over LINE sync over PLAIN
  // Preference 2: AUTO_ACCEPT over CORROBORATED_ACCEPT over FALLBACK_ONLY
  // Preference 3: Highest totalScore
  scoredCandidates.sort((a, b) => {
    const getSyncTier = (c: LyricsCandidate, s: MatchScoreBreakdown) => {
      // Real word sync with acceptable match score is gold standard
      if (c.richSync && c.richSync.length >= 3 && s.totalScore >= 0.70) return 3;
      // Line sync with good confidence
      if (c.syncedLyrics && s.totalScore >= 0.65) return 2;
      return 1;
    };

    const syncTierDiff = getSyncTier(b.candidate, b.score) - getSyncTier(a.candidate, a.score);
    if (syncTierDiff !== 0) return syncTierDiff;

    const rankOrder = { AUTO_ACCEPT: 3, CORROBORATED_ACCEPT: 2, FALLBACK_ONLY: 1, REJECT: 0 };
    const decisionDiff = rankOrder[b.decision] - rankOrder[a.decision];
    if (decisionDiff !== 0) return decisionDiff;

    return b.score.totalScore - a.score.totalScore;
  });

  const winner = scoredCandidates[0];
  const bestCandidate = winner.candidate;

  // 6. Synchronization Normalization (Sections 12, 13 & 14)
  // Section 14 Core Rule: NEVER fabricate word karaoke. Real word sync only.
  let syncQuality: SyncQuality = 'NONE';
  let lines: LyricsLine[] = [];
  let plainText = bestCandidate.plainLyrics;

  if (bestCandidate.richSync && bestCandidate.richSync.length > 0) {
    const parsedRich = parseRichSync(bestCandidate.richSync);
    if (parsedRich.lines.length > 0) {
      lines = parsedRich.lines;
      syncQuality = parsedRich.isWordSyncValid ? 'WORD' : 'LINE';
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

  // 7. Script Detection & Transliteration (Sections 23, 24, 25, 27 & 28)
  const translitResult = enrichLinesWithRomanization(lines);

  // 8. Assemble Unified Lyrics Document (Section 12 & 32)
  const doc: LyricsDocument = {
    status: 'FOUND',
    identity: {
      title: identity.title,
      artist: identity.artists.join(', '),
      album: identity.album,
      durationMs: identity.durationMs,
      version: identity.version,
    },
    source: {
      provider: bestCandidate.providerId,
      confidence: winner.score.totalScore,
      providerTrackId: bestCandidate.providerTrackId,
      sourceReference: bestCandidate.sourceReference,
    },
    syncQuality,
    lines: translitResult.lines,
    plainText,
    capabilities: {
      plain: Boolean(plainText),
      lineSync: syncQuality === 'LINE' || syncQuality === 'WORD',
      wordSync: syncQuality === 'WORD',
      romanized: translitResult.hasRomanizedContent,
    },
    confidence: winner.score.totalScore,
    cachedAtMs: Date.now(),
  };

  // If we only have LINE-level sync, dispatch asynchronous word-level alignment generation
  if (syncQuality === 'LINE' && lines.length > 0) {
    triggerBackendAlignment(identity, lines);
  }

  // 9. Store in L1 Cache
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
    },
    source: {
      provider: 'fallback',
      confidence: 0.0,
    },
    syncQuality: 'NONE',
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
