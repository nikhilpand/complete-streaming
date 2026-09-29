import test from 'node:test';
import assert from 'node:assert/strict';
import { useCustomPlaylists } from '../store/useCustomPlaylists';
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
    duration_ms: 180000,
    has_media: true,
  };
}

test('Custom Playlists Store - CRUD, Songs, Reordering & Persistence', async (t) => {
  storage.clear();
  useCustomPlaylists.setState({ playlists: [] });

  await t.test('createPlaylist creates new playlist and persists to localStorage', () => {
    const id = useCustomPlaylists.getState().createPlaylist('Chill Vibes', 'Late night chill');
    const playlists = useCustomPlaylists.getState().playlists;

    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, id);
    assert.equal(playlists[0].title, 'Chill Vibes');
    assert.equal(playlists[0].description, 'Late night chill');
    assert.equal(playlists[0].songs.length, 0);

    const saved = JSON.parse(storage.get('sway_custom_playlists_v1') || '[]');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, 'Chill Vibes');
  });

  await t.test('addSongToPlaylist appends song and prevents duplicate entries', () => {
    const pl = useCustomPlaylists.getState().playlists[0];
    const s1 = makeSong('s1', 'Song 1');
    const s2 = makeSong('s2', 'Song 2');

    useCustomPlaylists.getState().addSongToPlaylist(pl.id, s1);
    useCustomPlaylists.getState().addSongToPlaylist(pl.id, s2);
    // Duplicate addition attempt
    useCustomPlaylists.getState().addSongToPlaylist(pl.id, s1);

    const updated = useCustomPlaylists.getState().getPlaylist(pl.id);
    assert.ok(updated);
    assert.equal(updated.songs.length, 2);
    assert.equal(updated.songs[0].id, 's1');
    assert.equal(updated.songs[1].id, 's2');
    assert.equal(useCustomPlaylists.getState().isSongInPlaylist(pl.id, 's1'), true);
    assert.equal(useCustomPlaylists.getState().isSongInPlaylist(pl.id, 'nonexistent'), false);
  });

  await t.test('reorderPlaylistSongs reorders songs accurately', () => {
    const pl = useCustomPlaylists.getState().playlists[0];
    const s3 = makeSong('s3', 'Song 3');
    useCustomPlaylists.getState().addSongToPlaylist(pl.id, s3);

    // Current: [s1, s2, s3] -> move s3 (index 2) to front (index 0)
    useCustomPlaylists.getState().reorderPlaylistSongs(pl.id, 2, 0);

    const updated = useCustomPlaylists.getState().getPlaylist(pl.id);
    assert.ok(updated);
    assert.equal(updated.songs[0].id, 's3');
    assert.equal(updated.songs[1].id, 's1');
    assert.equal(updated.songs[2].id, 's2');
  });

  await t.test('removeSongFromPlaylist removes specific song', () => {
    const pl = useCustomPlaylists.getState().playlists[0];
    useCustomPlaylists.getState().removeSongFromPlaylist(pl.id, 's1');

    const updated = useCustomPlaylists.getState().getPlaylist(pl.id);
    assert.ok(updated);
    assert.equal(updated.songs.length, 2);
    assert.equal(updated.songs.some((s) => s.id === 's1'), false);
    assert.equal(useCustomPlaylists.getState().isSongInPlaylist(pl.id, 's1'), false);
  });

  await t.test('renamePlaylist updates playlist title and timestamp', () => {
    const pl = useCustomPlaylists.getState().playlists[0];
    const beforeTime = pl.updatedAt;

    useCustomPlaylists.getState().renamePlaylist(pl.id, 'Lofi Beats', 'Updated vibe');

    const updated = useCustomPlaylists.getState().getPlaylist(pl.id);
    assert.ok(updated);
    assert.equal(updated.title, 'Lofi Beats');
    assert.equal(updated.description, 'Updated vibe');
    assert.ok(updated.updatedAt >= beforeTime);
  });

  await t.test('createPlaylist with initialSongs imports playlist with full tracklist', () => {
    const s1 = makeSong('yt:dQw4w9WgXcQ', 'Never Gonna Give You Up');
    const s2 = makeSong('spotify:song:4cOdK2wGLETKBW3PvgPWqT', 'Starboy');
    const importedId = useCustomPlaylists.getState().createPlaylist(
      'Imported Spotify Hits',
      'Imported from SPOTIFY (Curated by Spotify)',
      [s1, s2]
    );

    const imported = useCustomPlaylists.getState().getPlaylist(importedId);
    assert.ok(imported);
    assert.equal(imported.title, 'Imported Spotify Hits');
    assert.equal(imported.description, 'Imported from SPOTIFY (Curated by Spotify)');
    assert.equal(imported.songs.length, 2);
    assert.equal(imported.songs[0].id, 'yt:dQw4w9WgXcQ');
    assert.equal(imported.songs[1].id, 'spotify:song:4cOdK2wGLETKBW3PvgPWqT');

    const saved = JSON.parse(storage.get('sway_custom_playlists_v1') || '[]');
    assert.equal(saved.length, 2);
    assert.equal(saved[0].songs.length, 2);
  });

  await t.test('deletePlaylist removes playlist from store and persistence', () => {
    const all = [...useCustomPlaylists.getState().playlists];
    for (const p of all) {
      useCustomPlaylists.getState().deletePlaylist(p.id);
    }

    const playlists = useCustomPlaylists.getState().playlists;
    assert.equal(playlists.length, 0);

    const saved = JSON.parse(storage.get('sway_custom_playlists_v1') || '[]');
    assert.equal(saved.length, 0);
  });
});
