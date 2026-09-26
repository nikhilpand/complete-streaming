import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Song } from '@/lib/api/types';
import { getSavedVolume, getSavedMuted } from '@/lib/utils';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlaybackContext {
  source?: string;
  query?: string;
}

interface PlayerStore {
  currentTrack: Song | null;
  playbackContext: PlaybackContext | null;
  queue: Song[];
  queueIndex: number;
  queueGeneration: number;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  volume: number;
  isMuted: boolean;
  isShuffled: boolean;
  repeatMode: 'none' | 'one' | 'all';
  error: string | null;
  isQueueOpen: boolean;
  isLyricsOpen: boolean;

  setCurrentTrack: (track: Song, context?: PlaybackContext | null) => void;
  setPlaybackContext: (ctx: PlaybackContext | null) => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  addToQueue: (song: Song) => void;
  playNext: () => void;
  playPrev: () => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seekTo: (time: number) => void;
  setStatus: (s: PlayerStatus) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setBufferedTime: (b: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setError: (e: string | null) => void;
  toggleQueue: () => void;
  toggleLyrics: () => void;
}

export const usePlayerStore = create<PlayerStore>()(
  subscribeWithSelector((set, get) => ({
    currentTrack: null,
    playbackContext: null,
    queue: [],
    queueIndex: 0,
    queueGeneration: 0,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    volume: getSavedVolume(0.8),
    isMuted: getSavedMuted(false),
    isShuffled: false,
    repeatMode: 'none',
    error: null,
    isQueueOpen: false,
    isLyricsOpen: false,

    setCurrentTrack: (track, context = null) => set((s) => ({
      currentTrack: track,
      playbackContext: context,
      error: null,
      status: 'loading',
      bufferedTime: 0,
      queueGeneration: s.queueGeneration + 1,
    })),
    setPlaybackContext: (ctx) => set({ playbackContext: ctx }),
    setQueue: (songs, startIndex = 0) => set((s) => ({
      queue: songs,
      queueIndex: startIndex,
      queueGeneration: s.queueGeneration + 1,
    })),
    addToQueue: (song) => set((s) => ({ queue: [...s.queue, song] })),
    playNext: () => {
      const { queue, queueIndex, repeatMode, isShuffled } = get();
      if (!queue.length) return;
      if (repeatMode === 'one') {
        get().seekTo(0);
        get().play();
        return;
      }
      let next: number;
      if (isShuffled) {
        if (queue.length === 1) return;
        do {
          next = Math.floor(Math.random() * queue.length);
        } while (next === queueIndex);
      } else {
        next = queueIndex + 1;
        if (next >= queue.length) {
          if (repeatMode === 'all') {
            next = 0;
          } else {
            const lastTrack = get().currentTrack;
            if (lastTrack?.id) {
              const reqGen = get().queueGeneration + 1;
              set({ status: 'loading', queueGeneration: reqGen });
              import('@/lib/api/queue')
                .then(async ({ getNextQueue, queueTrackToSong }) => {
                  try {
                    const tracks = await getNextQueue(lastTrack.id, 5);
                    if (tracks && tracks.length > 0) {
                      if (get().queueGeneration !== reqGen || get().currentTrack?.id !== lastTrack.id) {
                        return;
                      }
                      const newSongs = tracks.map(queueTrackToSong);
                      const currentQ = get().queue;
                      const updatedQueue = [...currentQ, ...newSongs];
                      const nextIndex = currentQ.length;
                      set((s) => {
                        if (s.queueGeneration !== reqGen || s.currentTrack?.id !== lastTrack.id) return {};
                        return {
                          queue: updatedQueue,
                          queueIndex: nextIndex,
                          currentTrack: updatedQueue[nextIndex],
                          status: 'loading',
                          error: null,
                          queueGeneration: s.queueGeneration + 1,
                        };
                      });
                      return;
                    }
                  } catch {
                    // Fall through to idle
                  }
                  if (get().queueGeneration === reqGen && get().currentTrack?.id === lastTrack.id) {
                    set({ status: 'idle' });
                  }
                })
                .catch(() => {
                  if (get().queueGeneration === reqGen && get().currentTrack?.id === lastTrack.id) {
                    set({ status: 'idle' });
                  }
                });
              return;
            }
            set({ status: 'idle' });
            return;
          }
        }
      }
      set((s) => ({
        queueIndex: next,
        currentTrack: queue[next],
        error: null,
        status: 'loading',
        queueGeneration: s.queueGeneration + 1,
      }));
    },
    playPrev: () => {
      const { queue, queueIndex, currentTime } = get();
      if (!queue.length) return;
      if (currentTime > 3 || queueIndex === 0) {
        set({ currentTime: 0 });
        if (typeof window !== 'undefined') {
          import('@/lib/audio/AudioManager')
            .then(({ audioManager }) => audioManager?.seek(0))
            .catch(() => {});
        }
        return;
      }
      const prev = Math.max(0, queueIndex - 1);
      set((s) => ({
        queueIndex: prev,
        currentTrack: queue[prev],
        error: null,
        status: 'loading',
        queueGeneration: s.queueGeneration + 1,
      }));
    },
    play: () => {
      if (typeof window !== 'undefined') {
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => audioManager?.play().catch(() => {}))
          .catch(() => {});
      }
    },
    pause: () => {
      if (typeof window !== 'undefined') {
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => audioManager?.pause())
          .catch(() => {});
      }
    },
    togglePlayPause: () => {
      const { status } = get();
      if (typeof window !== 'undefined') {
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => {
            if (!audioManager) return;
            if (status === 'playing') {
              audioManager.pause();
            } else {
              audioManager.play().catch(() => {});
            }
          })
          .catch(() => {});
      }
    },
    seekTo: (time: number) => {
      if (typeof time !== 'number' || isNaN(time)) return;
      const safeTime = Math.max(0, time);
      if (typeof window !== 'undefined') {
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => audioManager?.seek(safeTime))
          .catch(() => {});
      }
      set({ currentTime: safeTime });
    },
    setStatus: (status) => set({ status }),
    setCurrentTime: (currentTime) => set({ currentTime }),
    setDuration: (duration) => set({ duration }),
    setBufferedTime: (bufferedTime) => set({ bufferedTime }),
    setVolume: (v: number) => {
      const safe = Math.max(0, Math.min(1, isNaN(v) ? 0.8 : v));
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('sway_volume', String(safe)); } catch {}
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => audioManager?.setVolume(safe))
          .catch(() => {});
      }
      set({ volume: safe });
      if (get().isMuted && safe > 0) {
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('sway_muted', 'false'); } catch {}
          import('@/lib/audio/AudioManager')
            .then(({ audioManager }) => audioManager?.setMuted(false))
            .catch(() => {});
        }
        set({ isMuted: false });
      }
    },
    setMuted: (m: boolean) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('sway_muted', String(m)); } catch {}
        import('@/lib/audio/AudioManager')
          .then(({ audioManager }) => audioManager?.setMuted(m))
          .catch(() => {});
      }
      set({ isMuted: m });
    },
    toggleShuffle: () => set((s) => ({ isShuffled: !s.isShuffled })),
    cycleRepeat: () => set((s) => ({
      repeatMode: s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none',
    })),
    setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
    toggleQueue: () => set((s) => ({ isQueueOpen: !s.isQueueOpen })),
    toggleLyrics: () => set((s) => ({ isLyricsOpen: !s.isLyricsOpen })),
  }))
);
