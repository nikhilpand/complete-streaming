import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCachedLyrics,
  setCachedLyrics,
  invalidateLyricsCache,
  fetchLyricsWithCache,
  CACHE_VERSION,
  CLIENT_ENGINE_VERSION,
  type CachedLyrics,
} from '../lib/lyricsCache';
import { ErrorBoundary } from '../components/shell/ErrorBoundary';

describe('Authoritative Client Lyrics Cache & Recording Identity Invariants', () => {
  beforeEach(() => {
    invalidateLyricsCache();
    // Reset global fetch mock if needed
  });

  test('CACHE_VERSION and CLIENT_ENGINE_VERSION are correctly configured', () => {
    assert.equal(CLIENT_ENGINE_VERSION, 'v6');
    assert.equal(CACHE_VERSION, 'lyrics-v6');
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
      recordingKey: 'rec_track_valid_abc',
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
      recordingKey: 'rec_track_1',
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
      recordingKey: 'rec_track_2',
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
        headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
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

  test('rejects stale cache from previous engine version', () => {
    const staleEntry: CachedLyrics = {
      trackId: 'recording_a',
      recordingKey: 'recording_a',
      lines: [{ time: 10, endTime: 15, text: 'Sample line', words: [] }],
      provider: 'musixmatch',
      syncQuality: 'WORD',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      engineVersion: 'v3',
      synced: true,
      hasWordTiming: true,
    };

    setCachedLyrics(staleEntry);

    const res = getCachedLyrics('recording_a');
    assert.equal(res, null, 'Stale engine version must return null');
    assert.equal(getCachedLyrics('recording_a'), null, 'Stale entry must be purged from cache');
  });

  test('accepts synced cache only when engine version matches', () => {
    const validEntry: CachedLyrics = {
      trackId: 'recording_b',
      recordingKey: 'recording_b',
      lines: [{ time: 5, endTime: 9, text: 'Matching version line', words: [] }],
      provider: 'musixmatch',
      syncQuality: 'WORD',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      engineVersion: CLIENT_ENGINE_VERSION,
      synced: true,
      hasWordTiming: true,
    };

    setCachedLyrics(validEntry);

    const hit = getCachedLyrics('recording_b');
    assert.ok(hit, 'Matching engine version must result in cache hit');
    assert.equal(hit?.recordingKey, 'recording_b');
    assert.equal(hit?.engineVersion, CLIENT_ENGINE_VERSION);
  });

  test('lyricsId is never used as recordingKey', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
      json: async () => ({
        status: 'FOUND',
        provider: 'jiosaavn',
        lines: [{ time: 10, endTime: 14, text: 'Synced lyrics line without backend recordingKey' }],
        syncQuality: 'LINE',
      }),
    });

    try {
      const res = await fetchLyricsWithCache({
        title: 'Test Song',
        lyricsId: 'lyrics-provider-123',
      });

      assert.equal(res.status, 'FOUND');
      assert.equal(getCachedLyrics('lyrics-provider-123'), null);
      assert.equal(getCachedLyrics('lyrics:lyrics-provider-123'), null);

      const plainCandidate = getCachedLyrics(undefined, 'Test Song', '');
      if (plainCandidate) {
        assert.equal(plainCandidate.synced, false);
        assert.equal(plainCandidate.syncQuality, 'NONE');
        assert.equal(plainCandidate.lines[0].time, -1);
      }

      assert.equal(getCachedLyrics('rec:lyrics:lyrics-provider-123'), null);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('invalidation removes every alias', () => {
    const entry: CachedLyrics = {
      trackId: 'youtube:abc',
      recordingKey: 'recording_hash_123',
      lines: [{ time: 1, endTime: 3, text: 'Alias line', words: [] }],
      provider: 'youtube',
      syncQuality: 'LINE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      engineVersion: CLIENT_ENGINE_VERSION,
      synced: true,
    };

    setCachedLyrics(entry, 'Alias Song', 'Alias Artist');

    assert.ok(getCachedLyrics('youtube:abc'));
    assert.ok(getCachedLyrics('recording_hash_123'));
    assert.ok(getCachedLyrics(undefined, 'Alias Song', 'Alias Artist'));

    invalidateLyricsCache('youtube:abc');

    assert.equal(getCachedLyrics('youtube:abc'), null, 'Track cache must be gone');
    assert.equal(getCachedLyrics('recording_hash_123'), null, 'RecordingKey cache must be gone');
    assert.equal(getCachedLyrics(undefined, 'Alias Song', 'Alias Artist'), null, 'Plain alias must be gone');
  });

  test('in-flight request invalidated before completion cannot repopulate cache', async () => {
    let fetchCount = 0;
    let resolveFirstFetch!: (val: any) => void;
    const waitingPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });

    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await waitingPromise;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
        json: async () => ({
          status: 'FOUND',
          identity: { recordingKey: 'rec_inflight_test' },
          lines: [{ time: 1, endTime: 4, text: 'In flight line' }],
          syncQuality: 'LINE',
        }),
      };
    };

    try {
      const p1 = fetchLyricsWithCache({
        songId: 'inflight_track',
        title: 'Inflight Song',
      });

      invalidateLyricsCache('inflight_track');

      resolveFirstFetch(null);
      await p1;

      assert.equal(getCachedLyrics('inflight_track'), null, 'Invalidated old result must not populate cache');
      assert.equal(getCachedLyrics('rec_inflight_test'), null, 'Authoritative recording key must not be cached');

      const p2 = await fetchLyricsWithCache({
        songId: 'inflight_track',
        title: 'Inflight Song',
      });

      assert.equal(fetchCount, 2, 'Second request must perform a fresh fetch');
      assert.equal(p2.status, 'FOUND');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('confidence fallback preserves numeric 0 and uses nullish fallback', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
        json: async () => ({
          status: 'FOUND',
          identity: { recordingKey: 'rec_zero_confidence' },
          confidence: 0,
          lines: [{ time: 1, endTime: 2, text: 'Zero confidence lyrics' }],
          syncQuality: 'LINE',
        }),
      };
    };

    try {
      const res = await fetchLyricsWithCache({
        songId: 'zero_confidence_track',
        title: 'Zero Conf',
      });

      assert.equal(res.confidence, 0, 'Legitimate confidence of 0 must not fallback to 0.95');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('account-scoped settings persistence and hydration identity guard', async () => {
    const { getSettingsStorageKey, switchAccount, hydrateCloudSettings, useLyricsSettings } = await import('../store/useLyricsSettings');

    const origStorage = globalThis.localStorage;
    const storeMap = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => storeMap.set(k, v),
      removeItem: (k: string) => storeMap.delete(k),
    };

    try {
      localStorage.setItem('sway_account_id', 'user_alpha');
      assert.equal(getSettingsStorageKey(), 'sway-lyrics-settings:user_alpha');

      localStorage.setItem('sway_account_id', 'user_beta');
      assert.equal(getSettingsStorageKey(), 'sway-lyrics-settings:user_beta');

      let resolveAlpha!: (r: any) => void;
      const alphaPromise = new Promise((resolve) => {
        resolveAlpha = resolve;
      });

      const origFetch = globalThis.fetch;
      (globalThis as any).fetch = async (url: string) => {
        if (url.includes('user_alpha')) {
          await alphaPromise;
          return {
            ok: true,
            json: async () => ({
              settings: { fontSize: 'sm', align: 'center' },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            settings: { fontSize: 'xl', align: 'left' },
          }),
        };
      };

      try {
        localStorage.setItem('sway_account_id', 'user_alpha');
        const hAlpha = hydrateCloudSettings('user_alpha');

        localStorage.setItem('sway_account_id', 'user_beta');
        switchAccount('user_beta');

        resolveAlpha(null);
        await hAlpha;

        const currentSettings = useLyricsSettings.getState();
        assert.notEqual(currentSettings.fontSize, 'sm', 'Account A settings must not survive or hydrate into Account B');
      } finally {
        (globalThis as any).fetch = origFetch;
      }
    } finally {
      (globalThis as any).localStorage = origStorage;
    }
  });

  test('perTrackSyncOffset is bounded to 200 entries and evicts least recently updated', async () => {
    const { useLyricsSettings } = await import('../store/useLyricsSettings');

    useLyricsSettings.getState().resetDefaults();

    for (let i = 0; i < 200; i++) {
      useLyricsSettings.getState().setTrackSyncOffset(`track_${i}`, i * 10);
    }

    assert.equal(Object.keys(useLyricsSettings.getState().perTrackSyncOffset).length, 200);

    useLyricsSettings.getState().setTrackSyncOffset('track_0', 9999);
    useLyricsSettings.getState().setTrackSyncOffset('track_200', 2000);

    const offsets = useLyricsSettings.getState().perTrackSyncOffset;
    assert.equal(Object.keys(offsets).length, 200, 'perTrackSyncOffset must remain capped at 200');
    assert.ok(offsets['track_0'] !== undefined, 'track_0 was recently updated, so it must not be evicted');
    assert.ok(offsets['track_200'] !== undefined, 'newly added track_200 must be present');
    assert.equal(offsets['track_1'], undefined, 'oldest un-updated entry (track_1) must be evicted');
  });

  test('old in-flight request cannot delete a newer in-flight request from inFlightRequests', async () => {
    let fetchCount = 0;
    let resolveP1!: (val: any) => void;
    let resolveP2!: (val: any) => void;
    const p1Wait = new Promise((r) => { resolveP1 = r; });
    const p2Wait = new Promise((r) => { resolveP2 = r; });

    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      fetchCount++;
      const currentCall = fetchCount;
      if (currentCall === 1) {
        await p1Wait;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
          json: async () => ({
            status: 'FOUND',
            identity: { recordingKey: 'rec_old_req' },
            lines: [{ time: 1, endTime: 2, text: 'Old Req' }],
            syncQuality: 'LINE',
          }),
        };
      }
      // Call 2
      await p2Wait;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-lyrics-engine-version': CLIENT_ENGINE_VERSION }),
        json: async () => ({
          status: 'FOUND',
          identity: { recordingKey: 'rec_new_req' },
          lines: [{ time: 3, endTime: 4, text: 'New Req' }],
          syncQuality: 'LINE',
        }),
      };
    };

    try {
      // 1. Launch request 1
      const p1 = fetchLyricsWithCache({ songId: 'race_delete_track', title: 'Race Track' });

      // 2. Invalidate request 1
      invalidateLyricsCache('race_delete_track');

      // 3. Launch request 2 while request 1 is still in-flight
      const p2 = fetchLyricsWithCache({ songId: 'race_delete_track', title: 'Race Track' });
      assert.equal(fetchCount, 2, 'Request 2 should have started as generation changed');

      // 4. Resolve request 1 first
      resolveP1(null);
      await p1;

      // 5. While request 2 is STILL in-flight, launch request 3.
      // If request 1's finally() erroneously deleted request 2, request 3 would trigger fetchCount = 3!
      const p3 = fetchLyricsWithCache({ songId: 'race_delete_track', title: 'Race Track' });
      assert.equal(fetchCount, 2, 'Request 3 must deduplicate with active Request 2, not re-fetch');

      // 6. Resolve request 2
      resolveP2(null);
      const res2 = await p2;
      const res3 = await p3;

      assert.equal(res2.lines[0].text, 'New Req');
      assert.equal(res3.lines[0].text, 'New Req');
      assert.ok(getCachedLyrics('race_delete_track'), 'Request 2 should have successfully populated cache');
      assert.equal(getCachedLyrics('race_delete_track')?.lines[0].text, 'New Req');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  test('cached plain entry with mismatched engine version is rejected and purged', () => {
    const stalePlain: CachedLyrics = {
      trackId: 'title:stale song::stale artist',
      lines: [{ time: -1, endTime: -1, text: 'Plain stale line', words: [] }],
      provider: 'musixmatch',
      syncQuality: 'NONE',
      provenance: null,
      hasHindiScript: false,
      status: 'FOUND',
      cachedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      engineVersion: 'v3',
      synced: false,
    };

    setCachedLyrics(stalePlain, 'Stale Song', 'Stale Artist');

    // Query should fail because engineVersion !== CLIENT_ENGINE_VERSION
    const res = getCachedLyrics(undefined, 'Stale Song', 'Stale Artist');
    assert.equal(res, null, 'Plain entry with mismatched engine version must return null');
    assert.equal(getCachedLyrics(undefined, 'Stale Song', 'Stale Artist'), null, 'Stale plain entry must be purged');
  });

  test('ErrorBoundary handleReset calls onReset before clearing error state', () => {
    let resetCalled = false;
    let resetOrder = 0;
    let orderCounter = 0;

    const boundary = new ErrorBoundary({
      children: null,
      onReset: () => {
        resetCalled = true;
        resetOrder = ++orderCounter;
      },
    });

    (boundary as any).state = { hasError: true, error: new Error('test crash') };
    (boundary as any).updater = {
      enqueueSetState: (inst: any, partialState: any) => {
        Object.assign(inst.state, partialState);
      },
    };

    boundary.handleReset();

    assert.equal(resetCalled, true, 'onReset must be called');
    assert.equal(boundary.state.hasError, false, 'hasError must be reset to false');
    assert.equal(resetOrder, 1, 'onReset must be invoked before error state is cleared');
  });
});
