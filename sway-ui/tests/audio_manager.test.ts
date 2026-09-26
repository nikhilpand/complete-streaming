import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Setup DOM mocks before importing AudioManager
class MockTimeRanges {
  private ranges: Array<{ start: number; end: number }>;
  constructor(ranges: Array<{ start: number; end: number }> = []) {
    this.ranges = ranges;
  }
  get length() {
    return this.ranges.length;
  }
  start(index: number) {
    return this.ranges[index]?.start ?? 0;
  }
  end(index: number) {
    return this.ranges[index]?.end ?? 0;
  }
}

class MockAudioElement {
  public src = '';
  public preload = '';
  public volume = 1.0;
  public muted = false;
  public currentTime = 0;
  public duration = 180;
  public paused = true;
  public ended = false;
  public buffered: MockTimeRanges = new MockTimeRanges([]);
  public error: { code: number; message: string } | null = null;

  private listeners: Map<string, Set<() => void>> = new Map();

  addEventListener(event: string, cb: () => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
  }

  removeEventListener(event: string, cb: () => void) {
    this.listeners.get(event)?.delete(cb);
  }

  dispatchEvent(event: string) {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of Array.from(set)) {
        cb();
      }
    }
  }

  async play() {
    this.paused = false;
    this.dispatchEvent('play');
    this.dispatchEvent('playing');
  }

  pause() {
    this.paused = true;
    this.dispatchEvent('pause');
  }
}

// Global browser mocks
(globalThis as any).Audio = MockAudioElement;
(globalThis as any).window = globalThis;
let rafCallbacks = new Map<number, (time: number) => void>();
let nextRafId = 1;

(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => {
  const id = nextRafId++;
  rafCallbacks.set(id, cb);
  return id;
};

(globalThis as any).cancelAnimationFrame = (id: number) => {
  rafCallbacks.delete(id);
};

// Import after globals are initialized
import { AudioManager, AudioEvent } from '../lib/audio/AudioManager';

describe('AudioManager Hardcore Edge Cases & State Machine', () => {
  let manager: AudioManager;

  beforeEach(() => {
    rafCallbacks.clear();
    nextRafId = 1;
    manager = new AudioManager();
  });

  afterEach(() => {
    manager.pause();
  });

  test('initial state before init()', () => {
    assert.equal(manager.currentTime, 0);
    assert.equal(manager.duration, 0);
    assert.equal(manager.volume, 0.8);
    assert.equal(manager.muted, false);
    assert.equal(manager.paused, true);
    assert.equal(manager.bufferedTime, 0);
    assert.equal(manager.audioElement, null);
  });

  test('init() sets up audio properties and listeners', () => {
    const audio = manager.init();
    assert.ok(audio);
    assert.equal(manager.audioElement, audio);
    assert.equal(audio.preload, 'auto');
    // Repeated init returns identical instance
    assert.equal(manager.init(), audio);
  });

  test('event emission and subscription isolation', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    const events: AudioEvent[] = [];
    const unsubscribe = manager.subscribe((ev) => events.push(ev));

    // Play event
    audio.dispatchEvent('play');
    assert.deepEqual(events[events.length - 1], { type: 'play' });

    // Pause event
    audio.dispatchEvent('pause');
    assert.deepEqual(events[events.length - 1], { type: 'pause' });

    // Loading / waiting
    audio.dispatchEvent('waiting');
    assert.deepEqual(events[events.length - 1], { type: 'loading' });

    // Canplay
    audio.dispatchEvent('canplay');
    assert.deepEqual(events[events.length - 1], { type: 'canplay' });

    // Ended
    audio.dispatchEvent('ended');
    assert.deepEqual(events[events.length - 1], { type: 'ended' });

    // Unsubscribe stops receiving events
    unsubscribe();
    audio.dispatchEvent('play');
    assert.equal(events.length, 5);
  });

  test('bufferedTime calculation across empty and multiple buffer ranges', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    const events: AudioEvent[] = [];
    manager.subscribe((ev) => {
      if (ev.type === 'progress') events.push(ev);
    });

    // Empty buffer
    audio.buffered = new MockTimeRanges([]);
    audio.dispatchEvent('progress');
    assert.equal(manager.bufferedTime, 0);
    assert.deepEqual(events[events.length - 1], { type: 'progress', bufferedTime: 0 });

    // Multi-range buffer takes the end of the last buffer range
    audio.buffered = new MockTimeRanges([
      { start: 0, end: 30 },
      { start: 40, end: 95.5 },
    ]);
    audio.dispatchEvent('progress');
    assert.equal(manager.bufferedTime, 95.5);
    assert.deepEqual(events[events.length - 1], { type: 'progress', bufferedTime: 95.5 });
  });

  test('volume change clamping and muting boundaries', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    const events: AudioEvent[] = [];
    manager.subscribe((ev) => {
      if (ev.type === 'volumechange') events.push(ev);
    });

    // Volume clamped to [0, 1]
    manager.setVolume(-0.5);
    assert.equal(audio.volume, 0);

    manager.setVolume(1.8);
    assert.equal(audio.volume, 1);

    manager.setVolume(0.45);
    assert.equal(audio.volume, 0.45);

    // Muted toggle
    manager.setMuted(true);
    assert.equal(audio.muted, true);
    manager.setMuted(false);
    assert.equal(audio.muted, false);

    // Trigger volumechange
    audio.dispatchEvent('volumechange');
    assert.ok(events.length > 0);
    assert.equal(events[events.length - 1].type, 'volumechange');
  });

  test('audio error mapping across standard codes and edge cases', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    const events: AudioEvent[] = [];
    manager.subscribe((ev) => {
      if (ev.type === 'error') events.push(ev);
    });

    const errorCodes: Record<number, string> = {
      1: 'Playback aborted',
      2: 'Network error during playback',
      3: 'Audio decode error',
      4: 'Format not supported',
    };

    for (const [code, expectedMsg] of Object.entries(errorCodes)) {
      audio.error = { code: Number(code), message: 'low level message' };
      audio.dispatchEvent('error');
      assert.deepEqual(events[events.length - 1], { type: 'error', message: expectedMsg });
    }

    // Unknown code falls back to error.message
    audio.error = { code: 999, message: 'Custom unknown audio failure' };
    audio.dispatchEvent('error');
    assert.deepEqual(events[events.length - 1], { type: 'error', message: 'Custom unknown audio failure' });

    // Null error falls back to default message
    audio.error = null;
    audio.dispatchEvent('error');
    assert.deepEqual(events[events.length - 1], { type: 'error', message: 'Playback failed' });
  });

  test('requestAnimationFrame ticker loop on playback and cancellation', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    const events: AudioEvent[] = [];
    manager.subscribe((ev) => {
      if (ev.type === 'timeupdate') events.push(ev);
    });

    audio.currentTime = 12.5;
    audio.duration = 240;
    audio.paused = false;

    // Trigger play starts RAF
    audio.dispatchEvent('play');
    assert.equal(rafCallbacks.size, 1);

    // Execute RAF tick
    const [rafId, tick] = Array.from(rafCallbacks.entries())[0];
    rafCallbacks.delete(rafId);
    tick(performance.now());

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'timeupdate', currentTime: 12.5, duration: 240 });

    // Pause stops RAF
    manager.pause();
    assert.equal(rafCallbacks.size, 0);
  });

  test('seek updates currentTime on audio element', () => {
    const audio = manager.init() as unknown as MockAudioElement;
    manager.seek(78.2);
    assert.equal(audio.currentTime, 78.2);
  });

  test('load() updates src only when changed', async () => {
    const audio = manager.init() as unknown as MockAudioElement;
    await manager.load('https://cdn.example.com/audio1.mp4');
    assert.equal(audio.src, 'https://cdn.example.com/audio1.mp4');

    // Setting same URL does not reassign
    audio.src = 'custom_preserved';
    await manager.load('custom_preserved');
    assert.equal(audio.src, 'custom_preserved');
  });

  test('play() handles NotAllowedError (autoplay policy rejection)', async () => {
    const audio = manager.init() as unknown as MockAudioElement;
    audio.play = async () => {
      const err = new Error('User interaction required');
      err.name = 'NotAllowedError';
      throw err;
    };

    const events: AudioEvent[] = [];
    manager.subscribe((ev) => events.push(ev));

    await assert.rejects(
      async () => await manager.play(),
      (err: Error) => {
        assert.equal(err.name, 'NotAllowedError');
        return true;
      }
    );

    // Emits pause event when blocked by autoplay
    assert.ok(events.some((e) => e.type === 'pause'));
  });

  test('play() handles AbortError silently without throwing', async () => {
    const audio = manager.init() as unknown as MockAudioElement;
    audio.play = async () => {
      const err = new Error('The play() request was interrupted');
      err.name = 'AbortError';
      throw err;
    };

    // Does not throw
    await manager.play();
  });
});
