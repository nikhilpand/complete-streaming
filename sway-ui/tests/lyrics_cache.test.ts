import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCachedLyrics,
  setCachedLyrics,
  invalidateLyricsCache,
  fetchLyricsWithCache,
  CACHE_VERSION,
  type CachedLyrics,
} from '../lib/lyricsCache';

describe('Authoritative Client Lyrics Cache & Recording Identity Invariants', () => {
  beforeEach(() => {
    invalidateLyricsCache();
    // Reset global fetch mock if needed
  });

  test('synced lyrics are strictly recording-keyed and do NOT leak across different tracks with same title/artist', () => {
    const trackASynced: CachedLyrics = {
      trackId: 'saavn:track_a',
      recordingKey: 'rec_sha256_track_a',
      lines: [
        {
          time: 12.5,
          endTime: 15.0,
          text: 'Hum tere bin ab reh nahi sakte',
          words: [
            { text: 'Hum', startTime: 12.5, endTime: 13.0 },
            { text: 'tere', startTime: 13.0, endTime: 13.5 },
          ],
        },
      ],
      provider: 'musixmatch',
      syncQuality: 'WORD',
      provenance: {
        syncType: 'WORD',
        timingProvenance: 'AUTHENTIC_WORD',
        timingSource: 'musixmatch',
        isAuthenticTiming: true,
        matchConfidence: 0.98,
        timingConfidence: 0.95,
        acousticConfidence: 0.92,
        overallConfidence: 0.96,
        confidence: 0.96,
      },
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 20,
      plainText: 'Hum tere bin ab reh nahi sakte',
      synced: true,
      hasWordTiming: true,
    };

    // Cache Track A (studio version)
    setCachedLyrics(trackASynced, 'Tum Hi Ho', 'Arijit Singh');

    // 1. Querying Track A with its trackId returns synced lyrics
    const cachedA = getCachedLyrics('saavn:track_a', 'Tum Hi Ho', 'Arijit Singh');
    assert.ok(cachedA);
    assert.equal(cachedA?.trackId, 'saavn:track_a');
    assert.equal(cachedA?.syncQuality, 'WORD');
    assert.equal(cachedA?.lines[0].time, 12.5);

    // 2. Querying Track B (live concert version, different trackId) with same title and artist
    // MUST return null (no timing contamination!)
    const cachedB = getCachedLyrics('youtube:track_b_live', 'Tum Hi Ho', 'Arijit Singh');
    assert.equal(cachedB, null, 'Track B must not receive Track A synced lyrics');

    // 3. Querying by title + artist WITHOUT trackId MUST only return plain-text (timing stripped)
    const plainCandidate = getCachedLyrics(undefined, 'Tum Hi Ho', 'Arijit Singh');
    assert.ok(plainCandidate, 'Plain-text candidate should exist');
    assert.equal(plainCandidate?.syncQuality, 'NONE');
    assert.equal(plainCandidate?.synced, false);
    assert.equal(plainCandidate?.lines[0].time, -1, 'Plain candidate must not contain timing');
  });

  test('negative cache for NOT_FOUND expires after short TTL (15s)', () => {
    const notFoundEntry: CachedLyrics = {
      trackId: 'track_missing_123',
      lines: [],
      provider: '',
      syncQuality: 'NONE',
      provenance: null,
      hasHindiScript: false,
      status: 'NOT_FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 15 * 1000, // 15 seconds
      synced: false,
    };

    setCachedLyrics(notFoundEntry, 'Obscure Song', 'Indie Artist');

    // Within TTL: returns NOT_FOUND
    const hit = getCachedLyrics('track_missing_123');
    assert.ok(hit);
    assert.equal(hit?.status, 'NOT_FOUND');

    // Simulate expiry: artificially advance past expiresAt
    notFoundEntry.expiresAt = Date.now() - 1;

    // After TTL: returns null (allowing re-attempt)
    const expired = getCachedLyrics('track_missing_123');
    assert.equal(expired, null, 'Expired NOT_FOUND must return null');
  });

  test('NETWORK_ERROR and SERVER_ERROR are NEVER cached', () => {
    const errorEntry: CachedLyrics = {
      trackId: 'track_error_500',
      lines: [],
      provider: '',
      syncQuality: 'NONE',
      provenance: null,
      hasHindiScript: false,
      status: 'ERROR',
      error: 'SERVER_ERROR',
      cachedAt: Date.now(),
      expiresAt: 0,
      synced: false,
    };

    setCachedLyrics(errorEntry, 'Broken Song', 'Unknown');

    // Verify it was not saved into cache
    const lookup = getCachedLyrics('track_error_500');
    assert.equal(lookup, null, 'Errors must never be cached');
  });

  test('FOUND cache entry expires after 20 minutes', () => {
    const foundEntry: CachedLyrics = {
      trackId: 'track_valid_abc',
      lines: [{ time: 1, endTime: 3, text: 'Hello world', words: [] }],
      provider: 'lrclib',
      syncQuality: 'LINE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 20 * 60 * 1000,
      synced: true,
    };

    setCachedLyrics(foundEntry);

    // Active
    assert.ok(getCachedLyrics('track_valid_abc'));

    // Expired
    foundEntry.expiresAt = Date.now() - 100;
    assert.equal(getCachedLyrics('track_valid_abc'), null);
  });

  test('invalidateLyricsCache purges track specifically or entirely', () => {
    const entryA: CachedLyrics = {
      trackId: 'track_1',
      lines: [{ time: 1, endTime: 2, text: 'Line 1', words: [] }],
      provider: 'lrclib',
      syncQuality: 'LINE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      synced: true,
    };
    const entryB: CachedLyrics = {
      trackId: 'track_2',
      lines: [{ time: 3, endTime: 4, text: 'Line 2', words: [] }],
      provider: 'lrclib',
      syncQuality: 'LINE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      synced: true,
    };

    setCachedLyrics(entryA);
    setCachedLyrics(entryB);

    assert.ok(getCachedLyrics('track_1'));
    assert.ok(getCachedLyrics('track_2'));

    // Purge specific
    invalidateLyricsCache('track_1');
    assert.equal(getCachedLyrics('track_1'), null);
    assert.ok(getCachedLyrics('track_2'));

    // Purge all
    invalidateLyricsCache();
    assert.equal(getCachedLyrics('track_2'), null);
  });

  test('fetchLyricsWithCache deduplicates concurrent in-flight requests', async () => {
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-lyrics-engine-version': 'v4' }),
        json: async () => ({
          status: 'FOUND',
          lines: [{ startMs: 1000, endMs: 3000, text: 'Concurrent line' }],
          syncQuality: 'LINE',
        }),
      };
    };

    try {
      // Launch 3 parallel requests for the same track ID
      const [res1, res2, res3] = await Promise.all([
        fetchLyricsWithCache({ songId: 'concurrent_track_99', title: 'Concurrent Test' }),
        fetchLyricsWithCache({ songId: 'concurrent_track_99', title: 'Concurrent Test' }),
        fetchLyricsWithCache({ songId: 'concurrent_track_99', title: 'Concurrent Test' }),
      ]);

      assert.equal(fetchCount, 1, 'Concurrent requests for the same track should be deduplicated to 1 network call');
      assert.equal(res1.status, 'FOUND');
      assert.equal(res2.status, 'FOUND');
      assert.equal(res3.status, 'FOUND');
      assert.equal(res1.lines[0].text, 'Concurrent line');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('fetchLyricsWithCache differentiates NETWORK_ERROR and does not cache it', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      throw new TypeError('Failed to fetch (offline)');
    };

    try {
      const res = await fetchLyricsWithCache({ songId: 'net_fail_track', title: 'Fail Test' });
      assert.equal(res.status, 'ERROR');
      assert.equal(res.error, 'NETWORK_ERROR');

      // Verify that this failure is NOT cached
      const cached = getCachedLyrics('net_fail_track');
      assert.equal(cached, null, 'NETWORK_ERROR must not be cached');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('fetchLyricsWithCache differentiates SERVER_ERROR and does not cache it', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ error: 'Service Unavailable' }),
      };
    };

    try {
      const res = await fetchLyricsWithCache({ songId: 'server_fail_track', title: '503 Test' });
      assert.equal(res.status, 'ERROR');
      assert.equal(res.error, 'SERVER_ERROR');

      // Verify that this failure is NOT cached
      const cached = getCachedLyrics('server_fail_track');
      assert.equal(cached, null, 'SERVER_ERROR must not be cached');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('fetchLyricsWithCache differentiates HTTP 429 Rate Limit and does not cache it', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 429,
        headers: new Headers(),
        json: async () => ({ error: 'Rate limit exceeded' }),
      };
    };

    try {
      const res = await fetchLyricsWithCache({ songId: 'rate_limited_track', title: 'Rate Limit Test' });
      assert.equal(res.status, 'ERROR');
      assert.equal(res.error, 'HTTP_429');

      // Must NOT be cached as NOT_FOUND or anything else
      const cached = getCachedLyrics('rate_limited_track');
      assert.equal(cached, null, 'Rate-limited responses must never be cached');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('fetchLyricsWithCache differentiates upstream JSON error payload and does not cache it', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ status: 'ERROR', error: 'Database connection failed' }),
      };
    };

    try {
      const res = await fetchLyricsWithCache({ songId: 'json_error_track', title: 'Error Payload Test' });
      assert.equal(res.status, 'ERROR');
      assert.equal(res.error, 'Database connection failed');

      const cached = getCachedLyrics('json_error_track');
      assert.equal(cached, null, 'Upstream error payloads must never be cached');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('fetchLyricsWithCache negative-caches HTTP 404 with short TTL', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: 'Not found' }),
      };
    };

    try {
      const res = await fetchLyricsWithCache({ songId: 'legit_404_track', title: '404 Test' });
      assert.equal(res.status, 'NOT_FOUND');

      const cached = getCachedLyrics('legit_404_track');
      assert.ok(cached);
      assert.equal(cached?.status, 'NOT_FOUND');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('recording key normalizer handles yt: prefix and matches youtube: tracks', () => {
    const entry: CachedLyrics = {
      trackId: 'youtube:dQw4w9WgXcQ',
      recordingKey: 'rec_rick_astley',
      lines: [{ time: 1, endTime: 2, text: 'Never gonna give you up', words: [] }],
      provider: 'youtube',
      syncQuality: 'LINE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      synced: true,
    };

    setCachedLyrics(entry, 'Never Gonna Give You Up', 'Rick Astley');

    // Query with youtube: prefix
    assert.ok(getCachedLyrics('youtube:dQw4w9WgXcQ'));
    // Query with normalized yt: prefix
    assert.ok(getCachedLyrics('yt:dQw4w9WgXcQ'), 'yt: prefix must find youtube: cached entry');
  });

  test('synced lyrics without plainText field generate stripped plain-text entries for title+artist lookup', () => {
    const syncedNoPlain: CachedLyrics = {
      trackId: 'track_synced_no_plain',
      lines: [
        { time: 10, endTime: 12, text: 'Line one with timing', words: [{ text: 'Line', startTime: 10, endTime: 11 }] },
        { time: 13, endTime: 15, text: 'Line two with timing', words: [] },
      ],
      provider: 'musixmatch',
      syncQuality: 'WORD',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      synced: true,
      hasWordTiming: true,
    };

    setCachedLyrics(syncedNoPlain, 'Timed Song', 'Artist One');

    // Lookup by title + artist should find stripped plain-text
    const plain = getCachedLyrics(undefined, 'Timed Song', 'Artist One');
    assert.ok(plain, 'Stripped plain-text entry should be generated from lines');
    assert.equal(plain?.synced, false);
    assert.equal(plain?.lines[0].time, -1);
    assert.equal(plain?.lines[0].text, 'Line one with timing');
  });
});
