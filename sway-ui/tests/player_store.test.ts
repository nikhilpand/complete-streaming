import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { usePlayerStore } from '../store/playerStore';
import type { Song } from '../lib/api/types';

function createMockSong(id: string, title: string, artist: string = 'Artist'): Song {
  return {
    id,
    provider: 'saavn',
    provider_id: id,
    type: 'song',
    title,
    artists: [{ id: `art_${artist.toLowerCase()}`, name: artist, role: 'primary' }],
    album: 'Album',
    duration_ms: 210000,
    artwork_url: 'https://c.jpg',
    has_media: true,
  };
}

describe('Zustand Player Store Hardcore Edge Cases', () => {
  beforeEach(() => {
    // Reset Zustand store state to pristine initial values before each test
    usePlayerStore.setState({
      currentTrack: null,
      playbackContext: null,
      queue: [],
      queueIndex: 0,
      queueGeneration: 0,
      status: 'idle',
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      volume: 0.8,
      isMuted: false,
      isShuffled: false,
      repeatMode: 'none',
      error: null,
      isQueueOpen: false,
      isLyricsOpen: false,
    });
  });

  test('initial state verification', () => {
    const s = usePlayerStore.getState();
    assert.equal(s.currentTrack, null);
    assert.equal(s.queue.length, 0);
    assert.equal(s.queueIndex, 0);
    assert.equal(s.queueGeneration, 0);
    assert.equal(s.status, 'idle');
    assert.equal(s.currentTime, 0);
    assert.equal(s.duration, 0);
    assert.equal(s.volume, 0.8);
    assert.equal(s.isMuted, false);
    assert.equal(s.isShuffled, false);
    assert.equal(s.repeatMode, 'none');
    assert.equal(s.error, null);
  });

  test('setCurrentTrack increments generation, resets errors, and sets loading', () => {
    const song = createMockSong('s1', 'Song 1');
    const store = usePlayerStore.getState();

    // Inject dirty error and buffered time
    usePlayerStore.setState({ error: 'Previous failure', bufferedTime: 55 });

    store.setCurrentTrack(song, { source: 'search', query: 'arijit' });
    const next = usePlayerStore.getState();

    assert.equal(next.currentTrack?.id, 's1');
    assert.deepEqual(next.playbackContext, { source: 'search', query: 'arijit' });
    assert.equal(next.status, 'loading');
    assert.equal(next.error, null);
    assert.equal(next.bufferedTime, 0);
    assert.equal(next.queueGeneration, 1);
  });

  test('setQueue replaces tracks and updates queueIndex and generation', () => {
    const songs = [createMockSong('s1', 'Song 1'), createMockSong('s2', 'Song 2')];
    const store = usePlayerStore.getState();

    store.setQueue(songs, 1);
    const state = usePlayerStore.getState();

    assert.equal(state.queue.length, 2);
    assert.equal(state.queueIndex, 1);
    assert.equal(state.queueGeneration, 1);

    // addToQueue appends without mutating existing items
    store.addToQueue(createMockSong('s3', 'Song 3'));
    const appended = usePlayerStore.getState();
    assert.equal(appended.queue.length, 3);
    assert.equal(appended.queue[2].id, 's3');
  });

  test('playNext with empty queue does nothing', () => {
    const store = usePlayerStore.getState();
    store.playNext();
    const state = usePlayerStore.getState();
    assert.equal(state.queue.length, 0);
    assert.equal(state.queueIndex, 0);
  });

  test('playNext advances sequentially when repeatMode is none and in bounds', () => {
    const songs = [
      createMockSong('s1', 'Song 1'),
      createMockSong('s2', 'Song 2'),
      createMockSong('s3', 'Song 3'),
    ];
    usePlayerStore.setState({ queue: songs, queueIndex: 0, currentTrack: songs[0] });

    usePlayerStore.getState().playNext();
    let state = usePlayerStore.getState();
    assert.equal(state.queueIndex, 1);
    assert.equal(state.currentTrack?.id, 's2');

    usePlayerStore.getState().playNext();
    state = usePlayerStore.getState();
    assert.equal(state.queueIndex, 2);
    assert.equal(state.currentTrack?.id, 's3');
  });

  test('playNext with repeatMode "one" seeks to 0 and stays on current track', () => {
    const songs = [createMockSong('s1', 'Song 1'), createMockSong('s2', 'Song 2')];
    let seekCalledWith: number | null = null;
    let playCalled = false;

    usePlayerStore.setState({
      queue: songs,
      queueIndex: 0,
      currentTrack: songs[0],
      repeatMode: 'one',
      currentTime: 45,
      seekTo: (time: number) => {
        seekCalledWith = time;
      },
      play: () => {
        playCalled = true;
      },
    });

    usePlayerStore.getState().playNext();
    const state = usePlayerStore.getState();

    assert.equal(state.queueIndex, 0);
    assert.equal(seekCalledWith, 0);
    assert.equal(playCalled, true);
  });

  test('playNext with repeatMode "all" wraps from end of queue to index 0', () => {
    const songs = [createMockSong('s1', 'Song 1'), createMockSong('s2', 'Song 2')];
    usePlayerStore.setState({
      queue: songs,
      queueIndex: 1,
      currentTrack: songs[1],
      repeatMode: 'all',
    });

    usePlayerStore.getState().playNext();
    const state = usePlayerStore.getState();

    assert.equal(state.queueIndex, 0);
    assert.equal(state.currentTrack?.id, 's1');
  });

  test('playNext with isShuffled picks a different index', () => {
    const songs = [
      createMockSong('s1', 'Song 1'),
      createMockSong('s2', 'Song 2'),
      createMockSong('s3', 'Song 3'),
      createMockSong('s4', 'Song 4'),
    ];
    usePlayerStore.setState({
      queue: songs,
      queueIndex: 1,
      currentTrack: songs[1],
      isShuffled: true,
    });

    // Run multiple iterations: index must change and remain within valid bounds
    for (let i = 0; i < 5; i++) {
      const prevIdx = usePlayerStore.getState().queueIndex;
      usePlayerStore.getState().playNext();
      const nextIdx = usePlayerStore.getState().queueIndex;
      assert.notEqual(nextIdx, prevIdx);
      assert.ok(nextIdx >= 0 && nextIdx < songs.length);
    }

    // 1-item queue does not loop infinitely
    usePlayerStore.setState({
      queue: [songs[0]],
      queueIndex: 0,
      currentTrack: songs[0],
      isShuffled: true,
    });
    usePlayerStore.getState().playNext();
    assert.equal(usePlayerStore.getState().queueIndex, 0);
  });

  test('playPrev seeks to 0 if currentTime > 3s, otherwise decrements index', () => {
    const songs = [createMockSong('s1', 'Song 1'), createMockSong('s2', 'Song 2')];
    let seekCalledWith: number | null = null;

    usePlayerStore.setState({
      queue: songs,
      queueIndex: 1,
      currentTrack: songs[1],
      currentTime: 10,
      seekTo: (time: number) => {
        seekCalledWith = time;
      },
    });

    // 1. CurrentTime > 3s -> stays at index 1 and resets currentTime to 0
    usePlayerStore.getState().playPrev();
    let state = usePlayerStore.getState();
    assert.equal(state.queueIndex, 1);
    assert.equal(state.currentTime, 0);

    // 2. CurrentTime <= 3s -> decrements index to 0
    usePlayerStore.setState({ currentTime: 2 });
    usePlayerStore.getState().playPrev();
    state = usePlayerStore.getState();
    assert.equal(state.queueIndex, 0);
    assert.equal(state.currentTrack?.id, 's1');

    // 3. At index 0 -> resets currentTime to 0 and stays at 0
    usePlayerStore.setState({ currentTime: 1.5 });
    usePlayerStore.getState().playPrev();
    state = usePlayerStore.getState();
    assert.equal(state.queueIndex, 0);
    assert.equal(state.currentTime, 0);
  });

  test('volume boundaries and muting toggle', () => {
    const store = usePlayerStore.getState();

    store.setVolume(-0.8);
    assert.equal(usePlayerStore.getState().volume, 0);

    store.setVolume(1.5);
    assert.equal(usePlayerStore.getState().volume, 1);

    store.setVolume(0.65);
    assert.equal(usePlayerStore.getState().volume, 0.65);

    store.setMuted(true);
    assert.equal(usePlayerStore.getState().isMuted, true);
    store.setMuted(false);
    assert.equal(usePlayerStore.getState().isMuted, false);
  });

  test('cycleRepeat rotates "none" -> "all" -> "one" -> "none"', () => {
    const store = usePlayerStore.getState();
    assert.equal(usePlayerStore.getState().repeatMode, 'none');

    store.cycleRepeat();
    assert.equal(usePlayerStore.getState().repeatMode, 'all');

    store.cycleRepeat();
    assert.equal(usePlayerStore.getState().repeatMode, 'one');

    store.cycleRepeat();
    assert.equal(usePlayerStore.getState().repeatMode, 'none');
  });

  test('toggleShuffle and UI panel toggles', () => {
    const store = usePlayerStore.getState();

    assert.equal(usePlayerStore.getState().isShuffled, false);
    store.toggleShuffle();
    assert.equal(usePlayerStore.getState().isShuffled, true);

    assert.equal(usePlayerStore.getState().isQueueOpen, false);
    store.toggleQueue();
    assert.equal(usePlayerStore.getState().isQueueOpen, true);

    assert.equal(usePlayerStore.getState().isLyricsOpen, false);
    store.toggleLyrics();
    assert.equal(usePlayerStore.getState().isLyricsOpen, true);
  });

  test('playback status, timings, and error state setters', () => {
    const store = usePlayerStore.getState();

    store.setStatus('playing');
    assert.equal(usePlayerStore.getState().status, 'playing');

    store.setCurrentTime(32.4);
    assert.equal(usePlayerStore.getState().currentTime, 32.4);

    store.setDuration(198.0);
    assert.equal(usePlayerStore.getState().duration, 198.0);

    store.setBufferedTime(120.5);
    assert.equal(usePlayerStore.getState().bufferedTime, 120.5);

    store.setError('Audio stream 403 Forbidden');
    assert.equal(usePlayerStore.getState().error, 'Audio stream 403 Forbidden');
    store.setError(null);
    assert.equal(usePlayerStore.getState().error, null);
  });
});
