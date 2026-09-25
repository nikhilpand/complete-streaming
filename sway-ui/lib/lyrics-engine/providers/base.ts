/**
 * base.ts
 * Provider Adapter Contract (Section 2 & 8)
 */

import { TrackIdentity, LyricsCandidate } from '../types';
import { NormalizedMetadata } from '../normalizer';

export interface ILyricsProvider {
  readonly providerId: 'lrclib' | 'ytmusic' | 'musixmatch' | 'jiosaavn' | 'binilyrics' | string;
  resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]>;
}
