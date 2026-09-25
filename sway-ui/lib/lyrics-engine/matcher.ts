/**
 * matcher.ts
 * Deterministic Match Scoring & Acceptance Engine (Section 9 & 10)
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
function tokenSimilarity(a: string, b: string): number {
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

  // Substring bonus (e.g. "Kesariya" is contained in "Kesariya From Brahmastra")
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    return Math.max(jaccard, 0.80);
  }

  return jaccard;
}

/**
 * Calculates artist similarity across artist arrays
 */
function artistSimilarity(targetArtists: string[], candidateArtists: string[]): number {
  if (targetArtists.length === 0 && candidateArtists.length === 0) return 0.7;
  if (targetArtists.length === 0 || candidateArtists.length === 0) return 0.3;

  const primaryTarget = targetArtists[0].toLowerCase();
  const primaryCand = candidateArtists[0]?.toLowerCase() || '';

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
function calculateDurationScore(targetMs: number, candidateMs?: number): { score: number; deltaSec: number } {
  if (!targetMs || !candidateMs || targetMs <= 0 || candidateMs <= 0) {
    // If duration not known by candidate, assign neutral 0.5
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
 * Scores a candidate against the canonical TrackIdentity using the 6-factor model
 */
export function scoreLyricsCandidate(
  target: TrackIdentity,
  candidate: LyricsCandidate,
  isContentValid: boolean
): MatchScoreBreakdown {
  // 1. Title Similarity (30%)
  const candTitle = candidate.title || '';
  const titleScore = tokenSimilarity(target.title, candTitle);

  // 2. Artist Similarity (30%)
  const artistScore = artistSimilarity(target.artists, candidate.artists);

  // 3. Duration Score (15%)
  const { score: durationScore, deltaSec } = calculateDurationScore(target.durationMs, candidate.durationMs);

  // 4. Version & Album Consistency (10%)
  const candVersion = detectTrackVersion(candTitle, candidate.album || '');
  let versionScore = 1.0;
  let versionPenaltyApplied = false;
  let rejectionReason: string | undefined;

  // Strict version collisions (Section 9)
  // original ↔ live -> reject
  // original ↔ remix -> reject
  // song ↔ instrumental -> reject
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

  // 5. Provider Identity Bonus (10%)
  let providerBonus = 0.7; // baseline
  if (target.providerId && candidate.providerId === target.providerId) {
    providerBonus = 1.0; // Same provider origin trust bonus
  } else if (target.providerTrackId && candidate.providerTrackId === target.providerTrackId) {
    providerBonus = 1.0;
  }

  // 6. Content Sanity (5%)
  const contentSanityScore = isContentValid ? 1.0 : 0.0;

  // Calculate weighted total score:
  // Title (30%) + Artist (30%) + Duration (15%) + Version (10%) + Provider (10%) + Sanity (5%)
  let totalScore =
    titleScore * 0.30 +
    artistScore * 0.30 +
    durationScore * 0.15 +
    versionScore * 0.10 +
    providerBonus * 0.10 +
    contentSanityScore * 0.05;

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

  // If severe version collision, cap score at 0.50 so it never auto-accepts
  if (versionPenaltyApplied && versionScore === 0.0) {
    totalScore = Math.min(totalScore, 0.49);
  }

  // If content is corrupt, cap at 0
  if (!isContentValid) {
    totalScore = 0.0;
    if (!rejectionReason) rejectionReason = 'Content failed sanity validation';
  }

  return {
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
  if (score >= 0.90) return 'AUTO_ACCEPT';
  if (score >= 0.82) return 'CORROBORATED_ACCEPT';
  if (score >= 0.70) return 'FALLBACK_ONLY';
  return 'REJECT';
}
