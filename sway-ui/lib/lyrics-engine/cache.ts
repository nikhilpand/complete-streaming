/**
 * cache.ts
 * L1 LRU Cache & In-Flight Request Deduplication (Section 18, 19 & 20)
 */

import { LyricsDocument } from './types';

class LyricsL1Cache {
  private cache = new Map<string, { doc: LyricsDocument; expiresAt: number }>();
  private readonly maxItems = 1000;
  private readonly ttlMs = 20 * 60 * 1000; // 20 minutes L1 TTL

  get(identityHash: string): LyricsDocument | null {
    const entry = this.cache.get(identityHash);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(identityHash);
      return null;
    }

    // Refresh LRU order
    this.cache.delete(identityHash);
    this.cache.set(identityHash, entry);
    return entry.doc;
  }

  set(identityHash: string, doc: LyricsDocument) {
    const existing = this.cache.get(identityHash);
    if (existing && existing.doc.syncQuality === 'WORD' && doc.syncQuality !== 'WORD') {
      // Do not overwrite high-tier WORD sync with lower-tier LINE/NONE sync
      return;
    }

    if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    // 15 seconds negative cache for NOT_FOUND to allow transient recovery, 20m for FOUND
    const effectiveTtl = doc.status === 'FOUND' ? this.ttlMs : 15 * 1000;

    this.cache.set(identityHash, {
      doc: { ...doc, cachedAtMs: Date.now() },
      expiresAt: Date.now() + effectiveTtl,
    });
  }

  clear() {
    this.cache.clear();
  }
}

export const lyricsL1Cache = new LyricsL1Cache();

/**
 * In-Flight Request Deduplication (Section 20)
 * Ensures multiple concurrent requests for the same track identity share one resolution promise.
 */
class InFlightDeduplicator {
  private inFlight = new Map<string, Promise<LyricsDocument>>();

  async run(identityHash: string, resolver: () => Promise<LyricsDocument>): Promise<LyricsDocument> {
    const existing = this.inFlight.get(identityHash);
    if (existing) {
      return existing;
    }

    const promise = resolver().finally(() => {
      this.inFlight.delete(identityHash);
    });

    this.inFlight.set(identityHash, promise);
    return promise;
  }
}

export const inFlightDeduplicator = new InFlightDeduplicator();
