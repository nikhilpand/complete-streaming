import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../lib/audio/AudioEngine';
import { useAudioSettings, EQ_PRESETS } from '../store/useAudioSettings';

describe('Sprint 3, 4 & 5: AudioEngine & WebAudio Architecture', () => {
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
});
