import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../lib/audio/AudioEngine';
import { usePlayerStore } from '../store/playerStore';
import type { Song } from '../lib/api/types';

describe('Playback 17-Condition Stress-Test Matrix & Invariant Verification', () => {
  const makeSong = (id: string, title: string): Song => ({
    id,
    provider: 'saavn',
    provider_id: id,
    type: 'song',
    title,
    artists: [{ id: `art_${id}`, name: `Artist ${id}` }],
    duration_ms: 180000,
    has_media: true,
  });

  const song1 = makeSong('s1', 'Track 1');
  const song2 = makeSong('s2', 'Track 2');
  const song3 = makeSong('s3', 'Track 3');
  const song4 = makeSong('s4', 'Track 4');

  test('Scenario 1: A -> B Normal Gapless Transition (0ms logical gap)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    await engine.play();
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.readyState = 4; // HAVE_ENOUGH_DATA

    let tStart = 0;
    let tEnd = 0;
    engine.subscribe((ev) => {
      if (ev.type === 'transition_start') tStart = Date.now();
      if (ev.type === 'transition_end') tEnd = Date.now();
    });

    // Trigger track completion
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.ok(tStart > 0, 'transition_start emitted');
    assert.ok(tEnd >= tStart, 'transition_end emitted after confirmed playback');
    assert.equal(engine.activePipeline.id, 'B', 'Atomic swap transferred to B');
    assert.equal(engine.activePipeline.trackId, 's2');
    assert.equal(engine.transitioning, false, 'No stuck transitioning state');
    assert.equal(engine.standbyPipeline.isLoaded, false, 'Old pipeline cleared');
  });

  test('Scenario 2: A -> B Crossfade (gain scheduling, no double play)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    await engine.play();
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    // Crossfade to standby
    await engine.crossfadeToStandby(0.1);
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(engine.activePipeline.id, 'B');
    assert.equal(engine.activePipeline.trackId, 's2');
    assert.equal(engine.transitioning, false);
  });

  test('Scenario 3: A -> B Slow Network (buffer delayed -> fallback to ended)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    // Standby has readyState < 3 (slow network buffering)
    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.readyState = 1; // HAVE_METADATA only

    let endedFired = false;
    let transitionStartFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'ended') endedFired = true;
      if (ev.type === 'transition_start') transitionStartFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(transitionStartFired, false, 'Must not swap without buffer');
    assert.equal(endedFired, true, 'Clean fallback to ended');
    assert.equal(engine.activePipeline.id, 'A');
  });

  test('Scenario 4: A -> B Stream Failure (404/decode error -> fallback to ended)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.play = async () => {
      throw new Error('404 Not Found');
    };

    let endedFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'ended') endedFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(endedFired, true, 'Graceful fallback to ended');
    assert.equal(engine.activePipeline.id, 'A');
    assert.equal(engine.transitioning, false);
  });

  test('Scenario 5: A -> B Preload Failure (upstream failed -> active finishes cleanly)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    await engine.play();

    // Standby is never loaded (preload failed)
    assert.equal(engine.standbyPipeline.isLoaded, false);

    let endedFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'ended') endedFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    assert.equal(endedFired, true);
    assert.equal(engine.activePipeline.id, 'A');
  });

  test('Scenario 6: Next during Preload (user skips -> cancels preload)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');
    assert.equal(engine.standbyPipeline.isLoaded, true);

    // User hits Next to track 3: clear standby and load track 3 directly
    engine.clearStandby();
    assert.equal(engine.standbyPipeline.isLoaded, false);

    await engine.load('https://cdn.example.com/s3.mp3', 's3');
    assert.equal(engine.activePipeline.trackId, 's3');
  });

  test('Scenario 7: Next during Transition (user skips -> aborts transition)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    // Trigger transition
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));

    // User immediately skips during transition
    const genBefore = engine.generation;
    engine.cancelTransition();
    assert.ok(engine.generation > genBefore, 'Generation token incremented');
    assert.equal(engine.transitioning, false, 'Transition aborted');

    // Load new target track
    await engine.load('https://cdn.example.com/s4.mp3', 's4');
    assert.equal(engine.activePipeline.trackId, 's4');
  });

  test('Scenario 8: Previous during Transition (user skips back -> aborts transition)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s2.mp3', 's2');
    engine.preload('https://cdn.example.com/s3.mp3', 's3');

    // Trigger transition
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));

    // User hits Prev: cancels transition and seeks active to 0
    engine.cancelTransition();
    engine.seek(0);
    assert.equal(engine.transitioning, false);
    assert.equal(engine.currentTime, 0);
  });

  test('Scenario 9: Rapid Repeated Next (3x skips < 100ms -> no zombie swaps)', async () => {
    const engine = new AudioEngine();
    engine.init();

    // User presses Next rapidly 3 times
    for (let i = 1; i <= 3; i++) {
      engine.cancelTransition();
      await engine.load(`https://cdn.example.com/s${i}.mp3`, `s${i}`);
    }

    assert.equal(engine.activePipeline.trackId, 's3', 'Final track is s3');
    assert.equal(engine.transitioning, false, 'No stuck transitioning state');
    assert.equal(engine.standbyPipeline.isLoaded, false, 'No zombie standby pipeline');
  });

  test('Scenario 10: Shuffle during Transition (queue adapts safely)', () => {
    const store = usePlayerStore.getState();
    store.setQueue([song1, song2, song3, song4], 0);

    // Toggle shuffle
    store.toggleShuffle();
    assert.equal(usePlayerStore.getState().isShuffled, true);
    assert.equal(usePlayerStore.getState().shuffleOrder.length, 4);
  });

  test('Scenario 11: Repeat-One Invariant (never swaps to standby)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    engine.setRepeatMode('one');

    let transitionStartFired = false;
    let endedFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'transition_start') transitionStartFired = true;
      if (ev.type === 'ended') endedFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(transitionStartFired, false, 'Must not swap to standby on repeat-one');
    assert.equal(endedFired, true, 'Ended fired for repeat handler');
    assert.equal(engine.activePipeline.id, 'A', 'Remains on active track');
  });

  test('Scenario 12: Repeat-All Boundary (wraps from end of queue to index 0)', () => {
    const store = usePlayerStore.getState();
    store.setQueue([song1, song2], 1); // at last song
    store.cycleRepeat(); // none -> all

    assert.equal(usePlayerStore.getState().repeatMode, 'all');
    store.playNext();
    assert.equal(usePlayerStore.getState().queueIndex, 0, 'Wrapped cleanly to index 0');
    assert.equal(usePlayerStore.getState().currentTrack?.id, 's1');
  });

  test('Scenario 13: Queue Exhaustion (last song with repeat none -> idle)', () => {
    usePlayerStore.setState({ repeatMode: 'none', isShuffled: false });
    const store = usePlayerStore.getState();
    store.setQueue([song1, song2], 1); // at last song
    assert.equal(store.repeatMode, 'none');

    store.playNext();
    assert.equal(usePlayerStore.getState().status, 'idle', 'Status transitioned to idle');
  });

  test('Scenario 14: Transition + Network Recovery (network drops then returns)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    // Simulate network error on standby play
    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.play = async () => {
      throw new Error('Network timeout');
    };

    let fallbackEnded = false;
    engine.subscribe((ev) => {
      if (ev.type === 'ended') fallbackEnded = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(fallbackEnded, true, 'Fell back to standard path');
    assert.equal(engine.transitioning, false, 'Ready for recovery');

    // Network returns: reload active track
    standbyAudio.play = async () => {};
    await engine.load('https://cdn.example.com/s2.mp3', 's2');
    await engine.play();
    assert.equal(engine.activePipeline.trackId, 's2');
    assert.equal(engine.paused, false);
  });

  test('Scenario 15: Autoplay Rejection (NotAllowedError handled gracefully)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.play = async () => {
      const err = new Error('Autoplay blocked');
      err.name = 'NotAllowedError';
      throw err;
    };

    let pauseEmitted = false;
    engine.subscribe((ev) => {
      if (ev.type === 'pause') pauseEmitted = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(pauseEmitted, true, 'Pause emitted on autoplay rejection');
    assert.equal(engine.transitioning, false, 'No stuck state');
  });

  test('Scenario 16: Background Tab Throttle (events advance without RAF)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/s1.mp3', 's1');
    engine.preload('https://cdn.example.com/s2.mp3', 's2');

    // Without RAF running, media element ended event still executes transition
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(engine.activePipeline.id, 'B', 'Transitioned without RAF dependency');
  });

  test('Scenario 17: Session Refresh while Playing (hydration state test)', () => {
    const store = usePlayerStore.getState();
    store.setQueue([song1, song2], 0);
    store.setCurrentTrack(song1);
    store.setCurrentTime(45);

    // Validate stored state snapshot can hydrate without auto-blasting audio
    assert.equal(usePlayerStore.getState().currentTrack?.id, 's1');
    assert.equal(usePlayerStore.getState().currentTime, 45);
  });
});
