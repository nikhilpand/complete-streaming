import test from 'node:test';
import assert from 'node:assert/strict';
import { useRecentHistory } from '../store/useRecentHistory';
import type { Song } from '../lib/api/types';

// Mock localStorage
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

function makeSong(id: string, title: string): Song {
  return {
    id,
    provider: 'saavn',
    provider_id: id,
    type: 'song',
    title,
    artists: [{ id: 'a1', name: 'Artist 1', role: 'primary' }],
    artwork_url: 'https://example.com/art.jpg',
    duration_ms: 200000,
    has_media: true,
  };
}

test('Recent History Store - Add, Deduplication, Capping & Clear', async (t) => {
  storage.clear();
  useRecentHistory.setState({ history: [] });

  await t.test('addHistory prepends song and persists', () => {
    const s1 = makeSong('s1', 'Track 1');
    useRecentHistory.getState().addHistory(s1);

    const history = useRecentHistory.getState().history;
    assert.equal(history.length, 1);
    assert.equal(history[0].song.id, 's1');
    assert.ok(history[0].playedAt > 0);

    const saved = JSON.parse(storage.get('sway_recent_history_v1') || '[]');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].song.title, 'Track 1');
  });

  await t.test('addHistory moves re-played song to top without duplicates', () => {
    const s2 = makeSong('s2', 'Track 2');
    const s1 = makeSong('s1', 'Track 1');

    useRecentHistory.getState().addHistory(s2);
    // Replay s1: it should become index 0, s2 index 1
    useRecentHistory.getState().addHistory(s1);

    const history = useRecentHistory.getState().history;
    assert.equal(history.length, 2);
    assert.equal(history[0].song.id, 's1');
    assert.equal(history[1].song.id, 's2');
  });

  await t.test('addHistory caps at 50 tracks', () => {
    for (let i = 10; i < 75; i++) {
      useRecentHistory.getState().addHistory(makeSong(`track_${i}`, `Track ${i}`));
    }

    const history = useRecentHistory.getState().history;
    assert.equal(history.length, 50);
    assert.equal(history[0].song.id, 'track_74');
  });

  await t.test('removeHistoryItem removes specific item', () => {
    useRecentHistory.getState().removeHistoryItem('track_74');
    const history = useRecentHistory.getState().history;
    assert.equal(history.length, 49);
    assert.equal(history.some((h) => h.song.id === 'track_74'), false);
  });

  await t.test('clearHistory clears all history and storage', () => {
    useRecentHistory.getState().clearHistory();
    assert.equal(useRecentHistory.getState().history.length, 0);

    const saved = JSON.parse(storage.get('sway_recent_history_v1') || '[]');
    assert.equal(saved.length, 0);
  });
});
