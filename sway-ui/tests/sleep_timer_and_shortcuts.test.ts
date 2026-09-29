import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { fisherYates, usePlayerStore } from '../store/playerStore';
import { SleepTimer } from '../lib/playback/SleepTimer';

describe('Sprint 1 & 2: Sleep Timer, Fisher-Yates Shuffle & Shortcuts State', () => {
  test('fisherYates returns all elements without mutating original length or losing items', () => {
    const len = 10;
    const indices = fisherYates(len);
    assert.equal(indices.length, len);

    // Set of indices must contain 0..9
    const set = new Set(indices);
    assert.equal(set.size, len);
    for (let i = 0; i < len; i++) {
      assert.ok(set.has(i));
    }
  });

  test('fisherYates handles empty and single-element inputs safely', () => {
    assert.deepEqual(fisherYates(0), []);
    assert.deepEqual(fisherYates(1), [0]);
  });

  test('SleepTimer initializes and tracks remaining duration', () => {
    let tickCount = 0;
    let expired = false;

    const timer = new SleepTimer(
      () => {
        tickCount++;
      },
      () => {
        expired = true;
      }
    );

    assert.equal(timer.isActive(), false);
    assert.equal(timer.isEndOfTrackMode(), false);

    // Start 15-minute timer
    timer.start(15);
    assert.equal(timer.isActive(), true);
    assert.equal(timer.isEndOfTrackMode(), false);
    assert.ok(timer.getRemainingMs() <= 15 * 60 * 1000);
    assert.ok(timer.getRemainingMs() > 14 * 60 * 1000);

    // Clear timer
    timer.clear();
    assert.equal(timer.isActive(), false);

    // End of track mode
    timer.startEndOfTrack();
    assert.equal(timer.isActive(), true);
    assert.equal(timer.isEndOfTrackMode(), true);
    assert.equal(timer.getRemainingMs(), Infinity);

    timer.clear();
    assert.equal(timer.isActive(), false);
  });

  test('playerStore toggles shortcuts modal and updates sleep timer state', () => {
    const state = usePlayerStore.getState();
    assert.equal(state.isShortcutsOpen, false);
    assert.equal(state.sleepTimerActive, false);

    state.toggleShortcuts();
    assert.equal(usePlayerStore.getState().isShortcutsOpen, true);

    state.toggleShortcuts();
    assert.equal(usePlayerStore.getState().isShortcutsOpen, false);

    state.setSleepTimer(true, 60000);
    assert.equal(usePlayerStore.getState().sleepTimerActive, true);
    assert.equal(usePlayerStore.getState().sleepTimerRemainingMs, 60000);

    state.setSleepTimer(false, 0);
    assert.equal(usePlayerStore.getState().sleepTimerActive, false);
    assert.equal(usePlayerStore.getState().sleepTimerRemainingMs, 0);
  });
});
