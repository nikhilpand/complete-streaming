import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { artistNames, artUrl } from '../lib/utils';
import type { Song } from '../lib/api/types';

describe('Playback Logic, Metadata Extraction & Telemetry Boundaries', () => {
  test('artistNames extracts comma-separated names or parses artist from subtitle', () => {
    // 1. Multiple artists
    const arts = [
      { id: 'a1', name: 'Arijit Singh' },
      { id: 'a2', name: 'Mithoon' },
      { id: 'a3', name: 'Pritam' },
    ];
    assert.equal(artistNames(arts), 'Arijit Singh, Mithoon, Pritam');

    // 2. Single artist
    assert.equal(artistNames([{ name: 'Atif Aslam' }]), 'Atif Aslam');

    // 3. Subtitle with 'Album · Artist' format extracts the artist
    assert.equal(artistNames([], 'Aashiqui 2 · Ankit Tiwari'), 'Ankit Tiwari');

    // 4. Undefined artists falls back to subtitle or 'Unknown Artist'
    assert.equal(artistNames(undefined, 'Fallback Artist'), 'Fallback Artist');
    assert.equal(artistNames(undefined, undefined), 'Unknown Artist');
  });

  test('artUrl upgrades low-res thumbnails to 500x500 CDN URLs', () => {
    assert.equal(
      artUrl('https://c.saavncdn.com/123/150x150.jpg'),
      'https://c.saavncdn.com/123/500x500.jpg'
    );
    assert.equal(
      artUrl('https://c.saavncdn.com/123/50x50.jpg'),
      'https://c.saavncdn.com/123/500x500.jpg'
    );
    assert.equal(
      artUrl('https://c.saavncdn.com/123/500x500.jpg'),
      'https://c.saavncdn.com/123/500x500.jpg'
    );
    assert.equal(artUrl(''), '');
    assert.equal(artUrl(undefined), '');
  });

  test('track metadata extraction handles null, missing fields, and slugifies artist IDs', () => {
    function getTrackMeta(t: Song | null) {
      if (!t) return {};
      const aName = artistNames(t.artists, t.subtitle);
      const artistId = t.artists?.[0]?.id || (aName ? aName.toLowerCase().replace(/[^a-z0-9]+/g, '_') : undefined);
      return {
        title: t.title,
        artist: aName,
        artist_id: artistId,
        artwork_url: t.artwork_url,
      };
    }

    // 1. Null song
    assert.deepEqual(getTrackMeta(null), {});

    // 2. Song with full artist object
    const s1: Song = {
      id: 's1',
      provider: 'saavn',
      provider_id: 's1',
      type: 'song',
      title: 'Kesariya',
      artists: [{ id: 'art_pritam', name: 'Pritam' }],
      album: 'Brahmastra',
      duration_ms: 268000,
      artwork_url: 'https://c.jpg',
      has_media: true,
    };
    assert.deepEqual(getTrackMeta(s1), {
      title: 'Kesariya',
      artist: 'Pritam',
      artist_id: 'art_pritam',
      artwork_url: 'https://c.jpg',
    });

    // 3. Song with empty artists array slugifies subtitle
    const s2: Song = {
      id: 's2',
      provider: 'youtube',
      provider_id: 'vid1',
      type: 'song',
      title: 'Indie Hit',
      artists: [],
      subtitle: 'The Local Train',
      album: 'Aalas Ka Pedh',
      duration_ms: 210000,
      artwork_url: 'https://yt.jpg',
      has_media: true,
    };
    assert.deepEqual(getTrackMeta(s2), {
      title: 'Indie Hit',
      artist: 'The Local Train',
      artist_id: 'the_local_train',
      artwork_url: 'https://yt.jpg',
    });
  });

  test('telemetry skip event classification logic', () => {
    function classifySkip(positionSeconds?: number, ratio?: number) {
      if (positionSeconds !== undefined) {
        if (positionSeconds < 10) return 'skip_lt_10s';
        if (positionSeconds < 30) return 'skip_10_30s';
        return 'skip';
      }
      if (ratio !== undefined) {
        if (ratio < 0.1) return 'skip_lt_10s';
        if (ratio < 0.3) return 'skip_10_30s';
        return 'skip';
      }
      return 'skip_10_30s';
    }

    // Immediate skip (< 10 seconds)
    assert.equal(classifySkip(3.5), 'skip_lt_10s');
    assert.equal(classifySkip(9.9), 'skip_lt_10s');

    // Short audition skip (10-30 seconds)
    assert.equal(classifySkip(10.0), 'skip_10_30s');
    assert.equal(classifySkip(28.5), 'skip_10_30s');

    // Deep listen skip (> 30 seconds)
    assert.equal(classifySkip(45.0), 'skip');
    assert.equal(classifySkip(120.0), 'skip');

    // Ratio fallback when position is undefined
    assert.equal(classifySkip(undefined, 0.05), 'skip_lt_10s');
    assert.equal(classifySkip(undefined, 0.20), 'skip_10_30s');
    assert.equal(classifySkip(undefined, 0.60), 'skip');
  });

  test('media resolution exponential backoff calculation', () => {
    function getRetryDelay(attempt: number, maxDelayMs: number = 8000): number {
      const base = 500;
      return Math.min(base * Math.pow(2, attempt), maxDelayMs);
    }

    assert.equal(getRetryDelay(0), 500);
    assert.equal(getRetryDelay(1), 1000);
    assert.equal(getRetryDelay(2), 2000);
    assert.equal(getRetryDelay(3), 4000);
    assert.equal(getRetryDelay(4), 8000);
    assert.equal(getRetryDelay(5), 8000); // capped at max
  });
});
