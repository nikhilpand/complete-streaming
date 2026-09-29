import test from 'node:test';
import assert from 'node:assert/strict';
import { usePlayerStore } from '../store/playerStore';
import type { Song } from '../lib/api/types';

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

test('PlayerStore Queue Management - Remove, Clear & Move Reorder', async (t) => {
  const s0 = makeSong('s0', 'Song 0');
  const s1 = makeSong('s1', 'Song 1');
  const s2 = makeSong('s2', 'Song 2');
  const s3 = makeSong('s3', 'Song 3');

  await t.test('removeFromQueue on upcoming track preserves queueIndex and removes item', () => {
    usePlayerStore.setState({
      queue: [s0, s1, s2, s3],
      queueIndex: 1, // s1 is playing
      currentTrack: s1,
    });

    // Remove s3 (index 3)
    usePlayerStore.getState().removeFromQueue(3);
    const { queue, queueIndex, currentTrack } = usePlayerStore.getState();

    assert.equal(queue.length, 3);
    assert.equal(queueIndex, 1);
    assert.equal(currentTrack?.id, 's1');
    assert.equal(queue.some((s) => s.id === 's3'), false);
  });

  await t.test('removeFromQueue on preceding history item decrements queueIndex', () => {
    usePlayerStore.setState({
      queue: [s0, s1, s2],
      queueIndex: 1, // s1 is playing
      currentTrack: s1,
    });

    // Remove s0 (index 0)
    usePlayerStore.getState().removeFromQueue(0);
    const { queue, queueIndex, currentTrack } = usePlayerStore.getState();

    assert.equal(queue.length, 2);
    assert.equal(queueIndex, 0); // s1 is now at index 0
    assert.equal(currentTrack?.id, 's1');
  });

  await t.test('removeFromQueue on active track advances to next track', () => {
    usePlayerStore.setState({
      queue: [s0, s1, s2],
      queueIndex: 1, // s1 is playing
      currentTrack: s1,
    });

    // Remove active s1 (index 1)
    usePlayerStore.getState().removeFromQueue(1);
    const { queue, queueIndex, currentTrack } = usePlayerStore.getState();

    assert.equal(queue.length, 2);
    assert.equal(queueIndex, 1);
    assert.equal(currentTrack?.id, 's2');
  });

  await t.test('clearQueue clears upcoming tracks while preserving history up to current track', () => {
    usePlayerStore.setState({
      queue: [s0, s1, s2, s3],
      queueIndex: 2,
      currentTrack: s2,
    });

    usePlayerStore.getState().clearQueue();
    const { queue, queueIndex, currentTrack } = usePlayerStore.getState();

    assert.equal(queue.length, 3);
    assert.equal(queueIndex, 2);
    assert.equal(currentTrack?.id, 's2');
    assert.equal(queue.some((s) => s.id === 's3'), false);
  });

  await t.test('moveQueueItem reorders items and updates queueIndex appropriately', () => {
    usePlayerStore.setState({
      queue: [s0, s1, s2, s3],
      queueIndex: 1, // s1 is active
      currentTrack: s1,
    });

    // Move s3 (index 3) to right after s1 (index 2)
    usePlayerStore.getState().moveQueueItem(3, 2);
    let st = usePlayerStore.getState();
    assert.equal(st.queue[2].id, 's3');
    assert.equal(st.queue[3].id, 's2');
    assert.equal(st.queueIndex, 1); // active track stayed at index 1

    // Move active track s1 (index 1) to index 3
    usePlayerStore.getState().moveQueueItem(1, 3);
    st = usePlayerStore.getState();
    assert.equal(st.queue[3].id, 's1');
    assert.equal(st.queueIndex, 3); // queueIndex updated to follow active track
  });
});
