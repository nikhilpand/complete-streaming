/**
 * matcher.ts
 * Deterministic Recording Match & Multi-Candidate Scoring Engine (Section 9 & 10)
 *
 * Emphasizes exact recording match, text agreement, sync precision, and timing consistency.
 * Provider bonus is reduced to a secondary tie-breaker (weight 0.02).
 */

import { TrackIdentity, LyricsCandidate, MatchScoreBreakdown } from './types';
import { detectTrackVersion } from './identity';

function cleanStringForComparison(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-aware similarity between two strings (0.0 to 1.0)
 */
export function tokenSimilarity(a: string, b: string): number {
  const cleanA = cleanStringForComparison(a);
  const cleanB = cleanStringForComparison(b);
  if (!cleanA && !cleanB) return 1.0;
  if (!cleanA || !cleanB) return 0.0;
  if (cleanA === cleanB) return 1.0;

  const tokensA = new Set(cleanA.split(' ').filter(Boolean));
  const tokensB = new Set(cleanB.split(' ').filter(Boolean));

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Substring bonus (e.g. "Kesariya" contained in "Kesariya From Brahmastra")
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    return Math.max(jaccard, 0.80);
  }

  return jaccard;
}

/**
 * Calculates artist similarity across artist arrays
 */
export function artistSimilarity(targetArtists: string[], candidateArtists: string[]): number {
  if (targetArtists.length === 0 && candidateArtists.length === 0) return 0.7;
  if (targetArtists.length === 0 || candidateArtists.length === 0) return 0.3;

  const primaryTarget = cleanStringForComparison(targetArtists[0] || '');
  const primaryCand = cleanStringForComparison(candidateArtists[0] || '');

  // Exact primary artist match
  if (primaryTarget && primaryCand && (primaryTarget === primaryCand || primaryTarget.includes(primaryCand) || primaryCand.includes(primaryTarget))) {
    return 1.0;
  }

  // Cross-compare any artist
  let maxMatch = 0;
  for (const t of targetArtists) {
    for (const c of candidateArtists) {
      const sim = tokenSimilarity(t, c);
      if (sim > maxMatch) maxMatch = sim;
    }
  }

  return maxMatch;
}

/**
 * Duration scoring based on distance buckets:
 * <= 1s  -> 1.0
 * <= 2s  -> 0.85
 * <= 5s  -> 0.60
 * <= 10s -> 0.30
 * > 10s  -> 0.00
 */
export function calculateDurationScore(targetMs: number, candidateMs?: number): { score: number; deltaSec: number } {
  if (!targetMs || !candidateMs || targetMs <= 0 || candidateMs <= 0) {
    return { score: 0.5, deltaSec: -1 };
  }

  const deltaSec = Math.abs(targetMs - candidateMs) / 1000;
  if (deltaSec <= 1) return { score: 1.0, deltaSec };
  if (deltaSec <= 2) return { score: 0.85, deltaSec };
  if (deltaSec <= 5) return { score: 0.60, deltaSec };
  if (deltaSec <= 10) return { score: 0.30, deltaSec };
  return { score: 0.0, deltaSec };
}

/**
 * Evaluates exact recording identity matches (ISRC, exact IDs, exact duration match).
 */
export function calculateRecordingMatchScore(target: TrackIdentity, candidate: LyricsCandidate): number {
  // 1. Exact ISRC match is definitive recording identity
  if (target.isrc && candidate.isrc && target.isrc.toUpperCase() === candidate.isrc.toUpperCase()) {
    return 1.0;
  }

  // 2. Exact Video ID match
  if (target.videoId && candidate.videoId && target.videoId === candidate.videoId) {
    return 1.0;
  }

  // 3. Exact Provider Track ID match from the same provider
  if (
    target.providerTrackId &&
    candidate.providerTrackId &&
    target.providerTrackId === candidate.providerTrackId &&
    target.provider === candidate.providerId
  ) {
    return 1.0;
  }

  // 4. Exact duration alignment (< 1s) with strong metadata agreement
  if (target.durationMs > 0 && candidate.durationMs && candidate.durationMs > 0) {
    const deltaSec = Math.abs(target.durationMs - candidate.durationMs) / 1000;
    if (deltaSec <= 0.75) {
      return 0.90;
    } else if (deltaSec <= 1.5) {
      return 0.75;
    }
  }

  return 0.50;
}

/**
 * Scores a candidate against the canonical TrackIdentity using evidence-based ranking:
 * - Exact recording match: 20%
 * - Title Agreement: 25%
 * - Artist Agreement: 25%
 * - Duration Distance: 15%
 * - Version Consistency: 10%
 * - Provider Bonus (tie-breaker): 2%
 * - Content Sanity: 3%
 */
export function scoreLyricsCandidate(
  target: TrackIdentity,
  candidate: LyricsCandidate,
  isContentValid: boolean
): MatchScoreBreakdown {
  // 1. Recording Match (20%)
  const recordingMatchScore = calculateRecordingMatchScore(target, candidate);

  // 2. Title Similarity (25%)
  const candTitle = candidate.title || '';
  const titleScore = tokenSimilarity(target.title, candTitle);

  // 3. Artist Similarity (25%)
  const artistScore = artistSimilarity(target.artists, candidate.artists);

  // 4. Duration Score (15%)
  const { score: durationScore, deltaSec } = calculateDurationScore(target.durationMs, candidate.durationMs);

  // 5. Version & Album Consistency (10%)
  const candVersion = detectTrackVersion(candTitle, candidate.album || '');
  let versionScore = 1.0;
  let versionPenaltyApplied = false;
  let rejectionReason: string | undefined;

  // Strict version collisions
  if (target.version === 'original' && candVersion === 'live') {
    versionPenaltyApplied = true;
    versionScore = 0.0;
    rejectionReason = 'Version mismatch: target is original studio recording, candidate is live version';
  } else if (target.version === 'original' && candVersion === 'remix') {
    versionPenaltyApplied = true;
    versionScore = 0.0;
    rejectionReason = 'Version mismatch: target is original, candidate is remix';
  } else if (target.version === 'live' && candVersion === 'original') {
    versionPenaltyApplied = true;
    versionScore = 0.2;
    rejectionReason = 'Version mismatch: target is live, candidate is studio';
  } else if (target.version === 'remix' && candVersion === 'original') {
    versionPenaltyApplied = true;
    versionScore = 0.2;
    rejectionReason = 'Version mismatch: target is remix, candidate is original';
  } else if (!target.title.toLowerCase().includes('instrumental') && candidate.instrumental) {
    versionPenaltyApplied = true;
    versionScore = 0.0;
    rejectionReason = 'Version mismatch: target is vocal track, candidate is instrumental';
  }

  // 6. Provider Bonus (2% tie-breaker only)
  let providerBonus = 0.5;
  if (target.provider && candidate.providerId === target.provider) {
    providerBonus = 1.0;
  } else if (target.providerTrackId && candidate.providerTrackId === target.providerTrackId) {
    providerBonus = 1.0;
  }

  // 7. Content Sanity (3%)
  const contentSanityScore = isContentValid ? 1.0 : 0.0;

  // Composite calculation
  let totalScore =
    recordingMatchScore * 0.20 +
    titleScore * 0.25 +
    artistScore * 0.25 +
    durationScore * 0.15 +
    versionScore * 0.10 +
    providerBonus * 0.02 +
    contentSanityScore * 0.03;

  // Hard penalty: If delta > 10s and title or artist is mediocre, heavily downgrade
  if (deltaSec > 10 && (titleScore < 0.9 || artistScore < 0.9)) {
    totalScore = Math.min(totalScore, 0.65);
    if (!rejectionReason) {
      rejectionReason = `Duration delta too large (${deltaSec.toFixed(1)}s)`;
    }
  }

  // Hard penalty: If severe duration deviation (> 15s or > 15%), reject as different recording
  if (target.durationMs > 0 && candidate.durationMs && candidate.durationMs > 0) {
    const maxAllowedDelta = Math.max(15, (target.durationMs / 1000) * 0.15);
    if (deltaSec > maxAllowedDelta) {
      totalScore = Math.min(totalScore, 0.58);
      if (!rejectionReason) {
        rejectionReason = `Severe duration mismatch: target is ${(target.durationMs / 1000).toFixed(0)}s, candidate is ${(candidate.durationMs / 1000).toFixed(0)}s (delta ${deltaSec.toFixed(0)}s)`;
      }
    }
  }

  // Hard penalty: If artist match is completely zero (and target artist is known), cap below fallback threshold
  const hasKnownTargetArtist = target.artists.some((a) => a && a !== 'Unknown Artist');
  const hasKnownCandArtist = candidate.artists.some((a) => a && a !== 'Unknown Artist');
  if (hasKnownTargetArtist && hasKnownCandArtist && artistScore === 0) {
    totalScore = Math.min(totalScore, 0.55);
    if (!rejectionReason) {
      rejectionReason = 'Artist collision: zero artist similarity between candidate and target';
    }
  }

  // If severe version collision, cap score at 0.49 so it never auto-accepts
  if (versionPenaltyApplied && versionScore === 0.0) {
    totalScore = Math.min(totalScore, 0.49);
  }

  // If content is corrupt, cap at 0
  if (!isContentValid) {
    totalScore = 0.0;
    if (!rejectionReason) rejectionReason = 'Content failed sanity validation';
  }

  return {
    recordingMatchScore: Number(recordingMatchScore.toFixed(3)),
    titleScore: Number(titleScore.toFixed(3)),
    artistScore: Number(artistScore.toFixed(3)),
    durationScore: Number(durationScore.toFixed(3)),
    versionScore: Number(versionScore.toFixed(3)),
    providerBonus: Number(providerBonus.toFixed(3)),
    contentSanityScore: Number(contentSanityScore.toFixed(3)),
    totalScore: Number(Math.max(0, Math.min(1, totalScore)).toFixed(3)),
    versionPenaltyApplied,
    rejectionReason,
  };
}

export type AcceptanceDecision = 'AUTO_ACCEPT' | 'CORROBORATED_ACCEPT' | 'FALLBACK_ONLY' | 'REJECT';

export function evaluateAcceptance(score: number): AcceptanceDecision {
  if (score >= 0.88) return 'AUTO_ACCEPT';
  if (score >= 0.78) return 'CORROBORATED_ACCEPT';
  if (score >= 0.65) return 'FALLBACK_ONLY';
  return 'REJECT';
}
