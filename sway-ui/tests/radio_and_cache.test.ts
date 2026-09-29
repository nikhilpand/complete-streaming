import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { rankForDiversity } from '../lib/playback/RadioEngine';
import { sanitizeFilename } from '../lib/DownloadManager';
import { useSearchHistory } from '../store/useSearchHistory';
import type { Song } from '../lib/api/types';

function mockSong(id: string, artistName: string, title = 'Track'): Song {
  return {
    id,
    provider: 'saavn',
    provider_id: id,
    type: 'song',
    title,
    artists: [{ id: `art_${artistName}`, name: artistName, role: 'primary' }],
    has_media: true,
  };
}

describe('Sprint 6, 7 & 8: Radio Diversity, Filename Sanitization & Search History', () => {
  test('sanitizeFilename removes illegal Windows & POSIX characters', () => {
    assert.equal(sanitizeFilename('Arijit/Singh:Live*Track?'), 'Arijit_Singh_Live_Track_');
    assert.equal(sanitizeFilename('Track <1> | "Special"\\Mix'), 'Track _1_ _ _Special__Mix');
    assert.equal(sanitizeFilename('Normal Track Name'), 'Normal Track Name');
  });

  test('rankForDiversity defers songs whose primary artist recently played', () => {
    const recent = [mockSong('h1', 'Arijit Singh')];
    const candidates = [
      mockSong('c1', 'Arijit Singh'),
      mockSong('c2', 'Atif Aslam'),
      mockSong('c3', 'Pritam'),
      mockSong('c4', 'Arijit Singh'),
    ];

    const ranked = rankForDiversity(candidates, recent);
    assert.equal(ranked.length, 4);

    // The first non-Arijit tracks should be promoted ahead of duplicate Arijit tracks
    assert.equal(ranked[0]?.artists?.[0]?.name, 'Atif Aslam');
    assert.equal(ranked[1]?.artists?.[0]?.name, 'Pritam');
    // Deferred Arijit tracks come after
    assert.equal(ranked[2]?.artists?.[0]?.name, 'Arijit Singh');
    assert.equal(ranked[3]?.artists?.[0]?.name, 'Arijit Singh');
  });

  test('useSearchHistory stores, deduplicates, caps at 20, and clears queries', () => {
    const store = useSearchHistory.getState();
    store.clearHistory();
    assert.deepEqual(useSearchHistory.getState().queries, []);

    store.addQuery('Arijit Singh');
    store.addQuery('Top Hindi 2024');
    store.addQuery('arijit singh'); // case-insensitive duplicate

    const current = useSearchHistory.getState().queries;
    assert.equal(current.length, 2);
    assert.equal(current[0], 'arijit singh'); // promoted to front
    assert.equal(current[1], 'Top Hindi 2024');

    // Remove single query
    useSearchHistory.getState().removeQuery('Top Hindi 2024');
    assert.deepEqual(useSearchHistory.getState().queries, ['arijit singh']);

    // Clear
    useSearchHistory.getState().clearHistory();
    assert.deepEqual(useSearchHistory.getState().queries, []);
  });
});
