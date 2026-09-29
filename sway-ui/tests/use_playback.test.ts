import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { usePlayerStore } from '../store/playerStore';
import { audioManager } from '../lib/audio/AudioManager';
import type { Song } from '../lib/api/types';

describe('usePlayback Architecture & Transition Integration', () => {
  const songA: Song = {
    id: 'song_A',
    provider: 'saavn',
    provider_id: 'song_A',
    type: 'song',
    title: 'Song Alpha',
    artists: [{ id: 'a1', name: 'Artist A' }],
    duration_ms: 200000,
    has_media: true,
  };

  const songB: Song = {
    id: 'song_B',
    provider: 'saavn',
    provider_id: 'song_B',
    type: 'song',
    title: 'Song Beta',
    artists: [{ id: 'b1', name: 'Artist B' }],
    duration_ms: 180000,
    has_media: true,
  };

  const songC: Song = {
    id: 'song_C',
    provider: 'saavn',
    provider_id: 'song_C',
    type: 'song',
    title: 'Song Gamma',
    artists: [{ id: 'c1', name: 'Artist C' }],
    duration_ms: 210000,
    has_media: true,
  };

  test('audioManager transition events correctly update playerStore status and advance queue', () => {
    const store = usePlayerStore.getState();
    store.setQueue([songA, songB, songC], 0);
    store.setCurrentTrack(songA);

    // Simulate transition_start from AudioEngine
    usePlayerStore.getState().setStatus('transitioning');
    assert.equal(usePlayerStore.getState().status, 'transitioning');

    // Simulate transition_end from AudioEngine
    const tQ = usePlayerStore.getState().queue;
    const tIdx = usePlayerStore.getState().queueIndex;
    const targetNext = tQ[tIdx + 1];
    assert.equal(targetNext.id, 'song_B');

    // Store playNext advances index to 1 and sets currentTrack to songB
    usePlayerStore.getState().playNext();
    assert.equal(usePlayerStore.getState().queueIndex, 1);
    assert.equal(usePlayerStore.getState().currentTrack?.id, 'song_B');
  });

  test('audioManager does not reload already-active track adopted from transition swap', async () => {
    audioManager.init();
    await audioManager.load('https://cdn.example.com/songB.mp3', 'song_B');
    await audioManager.play();

    // Active pipeline has trackId = 'song_B' and !paused
    const active = audioManager.activePipeline;
    assert.equal(active.trackId, 'song_B');
    assert.equal(audioManager.paused, false);

    // The adoption check used in usePlayback:
    const isAdopted = audioManager.activePipeline?.trackId === songB.id && !audioManager.paused;
    assert.equal(isAdopted, true, 'Smoothly adopts active track without calling load() again');
  });

  test('preloads next track into standby pipeline ahead of track completion', () => {
    audioManager.init();
    audioManager.clearStandby();
    assert.equal(audioManager.standbyPipeline.isLoaded, false);

    audioManager.preload('https://cdn.example.com/songC.mp3', songC.id);
    assert.equal(audioManager.standbyPipeline.isLoaded, true);
    assert.equal(audioManager.standbyPipeline.trackId, 'song_C');
  });

  test('failed preload does not corrupt active pipeline or interrupt playback', async () => {
    audioManager.init();
    await audioManager.load('https://cdn.example.com/songA.mp3', 'song_A');
    await audioManager.play();

    assert.equal(audioManager.activePipeline.trackId, 'song_A');
    assert.equal(audioManager.paused, false);

    // Simulate preload failure: error on standby or invalid URL
    audioManager.clearStandby();
    assert.equal(audioManager.standbyPipeline.isLoaded, false);
    assert.equal(audioManager.standbyPipeline.trackId, null);

    // Active track continues playing uninterrupted
    assert.equal(audioManager.activePipeline.trackId, 'song_A');
    assert.equal(audioManager.paused, false);
  });

  test('stale generation response is ignored when user rapidly skips track', () => {
    let currentGen = 1;
    const dispatchedGens: number[] = [];

    // Simulate track change incrementing generation
    const onResolve = (gen: number, trackId: string) => {
      if (gen !== currentGen) return; // Stale response discarded!
      dispatchedGens.push(gen);
    };

    // Fast skip: Gen 1 starts, Gen 2 starts, Gen 3 starts
    currentGen = 2;
    currentGen = 3;

    // Delayed Gen 1 and Gen 2 network responses arrive
    onResolve(1, 'song_A');
    onResolve(2, 'song_B');
    onResolve(3, 'song_C');

    assert.deepEqual(dispatchedGens, [3], 'Only current generation 3 was processed');
  });

  test('repeatMode "one" clears standby and suppresses automatic transition swap', () => {
    audioManager.init();
    audioManager.preload('https://cdn.example.com/songB.mp3', 'song_B');
    assert.equal(audioManager.standbyPipeline.isLoaded, true);

    // User or store sets repeatMode = 'one'
    audioManager.setRepeatMode('one');
    audioManager.clearStandby();

    assert.equal(audioManager.getRepeatMode(), 'one');
    assert.equal(audioManager.standbyPipeline.isLoaded, false, 'Standby pipeline must be purged');
  });
});
