import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for Node test runner
const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, String(val)),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};

(globalThis as any).localStorage = localStorageMock;
(globalThis as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { origin: 'http://localhost:3000' },
};

import { useLikedSongs } from '../store/useLikedSongs';
import type { Song } from '../lib/api/types';

const sampleSong1: Song = {
  id: 'saavn:track_001',
  provider: 'saavn',
  provider_id: 'track_001',
  type: 'song',
  title: 'Tum Hi Ho',
  artists: [{ id: 'arijit_singh', name: 'Arijit Singh', role: 'primary' }],
  album: 'Aashiqui 2',
  duration_ms: 262000,
  artwork_url: 'https://c.saavncdn.com/123.jpg',
  has_media: true,
};

const sampleSong2: Song = {
  id: 'youtube:video_999',
  provider: 'youtube',
  provider_id: 'video_999',
  type: 'song',
  title: 'Kesariya',
  artists: [{ id: 'arijit_singh', name: 'Arijit Singh', role: 'primary' }],
  album: 'Brahmastra',
  duration_ms: 268000,
  artwork_url: 'https://i.ytimg.com/vi/video_999.jpg',
  has_media: true,
};

describe('Persistent Liked Songs Store & Collection Management', () => {
  beforeEach(() => {
    localStorageMock.clear();
    useLikedSongs.setState({
      likedSongs: [],
      likedIds: new Set<string>(),
      isHydrated: true,
    });
  });

  test('initial state is empty', () => {
    const state = useLikedSongs.getState();
    assert.equal(state.likedSongs.length, 0);
    assert.equal(state.isLiked(sampleSong1.id), false);
  });

  test('toggleLike adds song and persists to localStorage', () => {
    const { toggleLike } = useLikedSongs.getState();
    toggleLike(sampleSong1);

    const state = useLikedSongs.getState();
    assert.equal(state.likedSongs.length, 1);
    assert.equal(state.likedSongs[0].id, sampleSong1.id);
    assert.equal(state.likedSongs[0].title, 'Tum Hi Ho');
    assert.equal(state.isLiked(sampleSong1.id), true);
    assert.equal(localStorageMock.getItem('sway_liked_saavn:track_001'), 'true');

    // Check JSON storage
    const rawStored = localStorageMock.getItem('sway_liked_songs_v1');
    assert.ok(rawStored);
    const parsed = JSON.parse(rawStored!);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, sampleSong1.id);
  });

  test('toggleLike on already liked song unlikes and removes from collection', () => {
    const { toggleLike } = useLikedSongs.getState();
    toggleLike(sampleSong1);
    assert.equal(useLikedSongs.getState().isLiked(sampleSong1.id), true);

    toggleLike(sampleSong1);
    const state = useLikedSongs.getState();
    assert.equal(state.likedSongs.length, 0);
    assert.equal(state.isLiked(sampleSong1.id), false);
    assert.equal(localStorageMock.getItem('sway_liked_saavn:track_001'), null);
  });

  test('toggleLike prepends newer liked songs to top of collection', () => {
    const { toggleLike } = useLikedSongs.getState();
    toggleLike(sampleSong1);
    toggleLike(sampleSong2);

    const state = useLikedSongs.getState();
    assert.equal(state.likedSongs.length, 2);
    assert.equal(state.likedSongs[0].id, sampleSong2.id); // Most recently liked is first
    assert.equal(state.likedSongs[1].id, sampleSong1.id);
  });

  test('removeLike explicitly removes track by ID', () => {
    const { toggleLike, removeLike } = useLikedSongs.getState();
    toggleLike(sampleSong1);
    toggleLike(sampleSong2);

    removeLike(sampleSong1.id);
    const state = useLikedSongs.getState();
    assert.equal(state.likedSongs.length, 1);
    assert.equal(state.likedSongs[0].id, sampleSong2.id);
    assert.equal(state.isLiked(sampleSong1.id), false);
    assert.equal(state.isLiked(sampleSong2.id), true);
  });

  test('isLiked handles null or undefined safely', () => {
    const state = useLikedSongs.getState();
    assert.equal(state.isLiked(null), false);
    assert.equal(state.isLiked(undefined), false);
    assert.equal(state.isLiked(''), false);
  });
});
