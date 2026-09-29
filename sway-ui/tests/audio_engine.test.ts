import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../lib/audio/AudioEngine';
import { useAudioSettings, EQ_PRESETS } from '../store/useAudioSettings';

describe('AudioEngine Architecture, Correctness & Seamless Transitions', () => {
  test('AudioEngine initializes dual pipelines (A and B)', () => {
    const engine = new AudioEngine();
    const active = engine.activePipeline;
    const standby = engine.standbyPipeline;

    assert.ok(active);
    assert.ok(standby);
    assert.equal(active.id, 'A');
    assert.equal(standby.id, 'B');
  });

  test('AudioEngine subscription emits volume and mute changes', () => {
    const engine = new AudioEngine();
    let lastVolume = 0;
    let lastMuted = false;

    const unsub = engine.subscribe((ev) => {
      if (ev.type === 'volumechange') {
        lastVolume = ev.volume;
        lastMuted = ev.muted;
      }
    });

    engine.setVolume(0.65);
    assert.equal(Math.round(lastVolume * 100), 65);

    engine.setMuted(true);
    assert.equal(lastMuted, true);

    unsub();
  });

  test('useAudioSettings clamps EQ bands to [-12dB, +12dB] and handles presets', () => {
    const state = useAudioSettings.getState();

    // Check presets
    state.setEqPreset('Bass Boost');
    assert.equal(useAudioSettings.getState().eqPreset, 'Bass Boost');
    assert.deepEqual(useAudioSettings.getState().eqBands, EQ_PRESETS['Bass Boost']);

    // Check custom clamping
    state.setEqBand(0, 25); // above +12dB
    assert.equal(useAudioSettings.getState().eqBands[0], 12);
    assert.equal(useAudioSettings.getState().eqPreset, 'Custom');

    state.setEqBand(1, -30); // below -12dB
    assert.equal(useAudioSettings.getState().eqBands[1], -12);

    // Preamp clamping [-6dB, +6dB]
    state.setPreampGainDb(15);
    assert.equal(useAudioSettings.getState().preampGainDb, 6);

    state.setPreampGainDb(-10);
    assert.equal(useAudioSettings.getState().preampGainDb, -6);
  });

  test('useAudioSettings handles crossfade durations correctly', () => {
    const state = useAudioSettings.getState();
    assert.equal(typeof state.crossfadeDuration, 'number');

    state.setCrossfadeDuration(8);
    assert.equal(useAudioSettings.getState().crossfadeDuration, 8);

    state.setCrossfadeDuration(0);
    assert.equal(useAudioSettings.getState().crossfadeDuration, 0); // gapless mode
  });

  test('AudioEngine preloads standby pipeline', () => {
    const engine = new AudioEngine();
    engine.init();
    assert.equal(engine.standbyPipeline.isLoaded, false);

    engine.preload('https://cdn.example.com/next.mp3', 'track_next');
    assert.equal(engine.standbyPipeline.isLoaded, true);
    assert.equal(engine.standbyPipeline.trackId, 'track_next');
    assert.equal(engine.standbyPipeline.audio.src, 'https://cdn.example.com/next.mp3');
  });

  test('AudioEngine does not swap without usable standby buffer (buffer < 0.5s or readyState < 3)', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/trackA.mp3', 'track_A');
    engine.preload('https://cdn.example.com/trackB.mp3', 'track_B');

    // Simulate standby being unbuffered / readyState < 3
    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.readyState = 2; // HAVE_CURRENT_DATA (not future data)

    let endedFired = false;
    let transitionStartFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'ended') endedFired = true;
      if (ev.type === 'transition_start') transitionStartFired = true;
    });

    // Simulate active track ended
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));

    assert.equal(transitionStartFired, false, 'Should not start transition without usable buffer');
    assert.equal(endedFired, true, 'Should fall back cleanly to normal ended event');
    assert.equal(engine.activePipeline.id, 'A', 'Active pipeline must remain A');
  });

  test('AudioEngine swaps A -> B and emits transition_start once then transition_end after confirmed playback', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/trackA.mp3', 'track_A');
    engine.preload('https://cdn.example.com/trackB.mp3', 'track_B');

    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.readyState = 4; // HAVE_ENOUGH_DATA

    const events: string[] = [];
    let transitionEndTrackId: string | undefined;

    engine.subscribe((ev) => {
      events.push(ev.type);
      if (ev.type === 'transition_end') {
        transitionEndTrackId = ev.trackId;
      }
    });

    // Trigger ended on active A
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));

    // Wait microtask for standby.audio.play() and playing event
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(events.includes('transition_start'), 'Must emit transition_start');
    assert.equal(
      events.filter((e) => e === 'transition_start').length,
      1,
      'Must emit transition_start exactly once'
    );
    assert.ok(events.includes('transition_end'), 'Must emit transition_end');
    assert.equal(transitionEndTrackId, 'track_B');

    // Verification of atomic swap
    assert.equal(engine.activePipeline.id, 'B', 'Active pipeline must now be B');
    assert.equal(engine.activePipeline.trackId, 'track_B');

    // Verification of old pipeline cleanup
    const oldPipeline = engine.standbyPipeline;
    assert.equal(oldPipeline.id, 'A');
    assert.equal(oldPipeline.isLoaded, false, 'Old pipeline must be marked unloaded');
    assert.equal(oldPipeline.trackId, null, 'Old pipeline trackId must be cleared');
    assert.equal(oldPipeline.audio.paused, true, 'Old pipeline must be paused');
  });

  test('AudioEngine handles B.play() rejection and falls back to ended event', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/trackA.mp3', 'track_A');
    engine.preload('https://cdn.example.com/trackB.mp3', 'track_B');

    const standbyAudio = engine.standbyPipeline.audio as any;
    standbyAudio.readyState = 4;
    // Mock play to reject (simulate network / decode / stream error)
    standbyAudio.play = async () => {
      throw new Error('Stream decode error');
    };

    let transitionStartFired = false;
    let transitionEndFired = false;
    let endedFired = false;

    engine.subscribe((ev) => {
      if (ev.type === 'transition_start') transitionStartFired = true;
      if (ev.type === 'transition_end') transitionEndFired = true;
      if (ev.type === 'ended') endedFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));

    await new Promise((r) => setTimeout(r, 50));

    assert.equal(transitionStartFired, true, 'Attempted transition');
    assert.equal(transitionEndFired, false, 'Must not emit transition_end on failure');
    assert.equal(endedFired, true, 'Must fall back cleanly to ended event');
    assert.equal(engine.activePipeline.id, 'A', 'Must remain on pipeline A');
    assert.equal(engine.transitioning, false, 'Must not be stuck in transitioning state');
  });

  test('AudioEngine ignores stale pipeline events from former active pipeline', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/trackA.mp3', 'track_A');
    engine.preload('https://cdn.example.com/trackB.mp3', 'track_B');

    // Perform swap to B
    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(engine.activePipeline.id, 'B');

    // Pipeline A is now inactive. Fire events on pipeline A's audio
    const oldAudio = engine.standbyPipeline.audio;
    let pauseEvents = 0;
    let errorEvents = 0;
    engine.subscribe((ev) => {
      if (ev.type === 'pause') pauseEvents++;
      if (ev.type === 'error') errorEvents++;
    });

    oldAudio.dispatchEvent(new Event('pause'));
    oldAudio.dispatchEvent(new Event('error'));

    assert.equal(pauseEvents, 0, 'Must ignore stale pause events from old pipeline');
    assert.equal(errorEvents, 0, 'Must ignore stale error events from old pipeline');
  });

  test('AudioEngine repeatMode "one" blocks automatic transition to standby', async () => {
    const engine = new AudioEngine();
    engine.init();
    await engine.load('https://cdn.example.com/trackA.mp3', 'track_A');
    engine.preload('https://cdn.example.com/trackB.mp3', 'track_B');

    engine.setRepeatMode('one');

    let transitionStartFired = false;
    let endedFired = false;
    engine.subscribe((ev) => {
      if (ev.type === 'transition_start') transitionStartFired = true;
      if (ev.type === 'ended') endedFired = true;
    });

    engine.activePipeline.audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(transitionStartFired, false, 'Must NOT start transition when repeatMode is one');
    assert.equal(endedFired, true, 'Must fire ended for store repeat handler');
    assert.equal(engine.activePipeline.id, 'A', 'Must stay on pipeline A');
  });
});
