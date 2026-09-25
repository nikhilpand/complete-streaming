import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Song } from '@/lib/api/types';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerStore {
  currentTrack: Song | null;
  queue: Song[];
  queueIndex: number;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isShuffled: boolean;
  repeatMode: 'none' | 'one' | 'all';
  error: string | null;
  isFullPlayerOpen: boolean;
  isQueueOpen: boolean;
  isLyricsOpen: boolean;

  setCurrentTrack: (track: Song) => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  addToQueue: (song: Song) => void;
  playNext: () => void;
  playPrev: () => void;
  setStatus: (s: PlayerStatus) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setError: (e: string | null) => void;
  openFullPlayer: () => void;
  closeFullPlayer: () => void;
  toggleQueue: () => void;
  toggleLyrics: () => void;
}

export const usePlayerStore = create<PlayerStore>()(
  subscribeWithSelector((set, get) => ({
    currentTrack: null,
    queue: [],
    queueIndex: 0,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    isShuffled: false,
    repeatMode: 'none',
    error: null,
    isFullPlayerOpen: false,
    isQueueOpen: false,
    isLyricsOpen: false,

    setCurrentTrack: (track) => set({ currentTrack: track, error: null, status: 'loading' }),
    setQueue: (songs, startIndex = 0) => set({ queue: songs, queueIndex: startIndex }),
    addToQueue: (song) => set((s) => ({ queue: [...s.queue, song] })),
    playNext: () => {
      const { queue, queueIndex, repeatMode, isShuffled } = get();
      if (!queue.length) return;
      if (repeatMode === 'one') return;
      let next: number;
      if (isShuffled) {
        // Pick a random index that is different from the current one,
        // but only if there is more than one track to choose from.
        if (queue.length === 1) return;
        do {
          next = Math.floor(Math.random() * queue.length);
        } while (next === queueIndex);
      } else {
        next = queueIndex + 1;
        if (next >= queue.length) {
          if (repeatMode === 'all') next = 0;
          else { set({ status: 'idle' }); return; }
        }
      }
      set({ queueIndex: next, currentTrack: queue[next], error: null, status: 'loading' });
    },
    playPrev: () => {
      const { queue, queueIndex, currentTime } = get();
      if (!queue.length) return;
      // If > 3s in, restart current track; else go to previous
      if (currentTime > 3) {
        set({ currentTime: 0 });
        // Seek on the audio element directly via the manager singleton
        if (typeof window !== 'undefined') {
          // Use a microtask to avoid circular module initialization issues
          Promise.resolve().then(async () => {
            const { audioManager } = await import('@/lib/audio/AudioManager');
            audioManager?.seek(0);
          }).catch(() => {
            // Dynamic import failed (e.g. SSR or bundle error) — ignore; the
            // store-level currentTime reset above is still applied.
          });
        }
        return;
      }
      const prev = Math.max(0, queueIndex - 1);
      set({ queueIndex: prev, currentTrack: queue[prev], error: null, status: 'loading' });
    },
    setStatus: (status) => set({ status }),
    setCurrentTime: (currentTime) => set({ currentTime }),
    setDuration: (duration) => set({ duration }),
    setVolume: (volume) => set({ volume }),
    setMuted: (isMuted) => set({ isMuted }),
    toggleShuffle: () => set((s) => ({ isShuffled: !s.isShuffled })),
    cycleRepeat: () => set((s) => ({
      repeatMode: s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none',
    })),
    setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
    openFullPlayer: () => set({ isLyricsOpen: true, isFullPlayerOpen: false }),
    closeFullPlayer: () => set({ isLyricsOpen: false, isFullPlayerOpen: false }),
    toggleQueue: () => set((s) => ({ isQueueOpen: !s.isQueueOpen })),
    toggleLyrics: () => set((s) => ({ isLyricsOpen: !s.isLyricsOpen })),
  }))
);
