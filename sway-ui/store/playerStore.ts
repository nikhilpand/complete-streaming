import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/lib/api/types';
import { getSavedVolume, getSavedMuted } from '@/lib/utils';

// Unified playback state machine status
export type PlayerStatus =
  | 'idle'
  | 'resolving'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'transitioning'
  | 'error';

export interface PlaybackContext {
  source?: string;
  query?: string;
}

interface PlayerStore {
  currentTrack: Song | null;
  playbackContext: PlaybackContext | null;
  queue: Song[];
  shuffleOrder: number[]; // Fisher-Yates persisted shuffle order
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
  // Sleep timer
  sleepTimerActive: boolean;
  sleepTimerRemainingMs: number;
  // Shortcuts modal
  isShortcutsOpen: boolean;

  setCurrentTrack: (track: Song, context?: PlaybackContext | null) => void;
  setPlaybackContext: (ctx: PlaybackContext | null) => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
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
  setSleepTimer: (active: boolean, remainingMs?: number) => void;
  toggleShortcuts: () => void;
}

/** Fisher-Yates shuffle — returns new index array, does NOT mutate */
export function fisherYates(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// In-memory fallback for environments without localStorage (Node.js test runners, SSR)
const memStore = new Map<string, string>();
const safeStorage = {
  getItem: (name: string): string | null => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(name);
      } catch {}
    }
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(name);
      } catch {}
    }
    return memStore.get(name) ?? null;
  },
  setItem: (name: string, value: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(name, value);
        return;
      } catch {}
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(name, value);
        return;
      } catch {}
    }
    memStore.set(name, value);
  },
  removeItem: (name: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(name);
        return;
      } catch {}
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(name);
        return;
      } catch {}
    }
    memStore.delete(name);
  },
};

// Persisted fields (schema v2)
type PersistedState = Pick<
  PlayerStore,
  | 'currentTrack'
  | 'queue'
  | 'shuffleOrder'
  | 'queueIndex'
  | 'repeatMode'
  | 'isShuffled'
  | 'volume'
  | 'isMuted'
  | 'currentTime'
>;

export const usePlayerStore = create<PlayerStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        currentTrack: null,
        playbackContext: null,
        queue: [],
        shuffleOrder: [],
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
        sleepTimerActive: false,
        sleepTimerRemainingMs: 0,
        isShortcutsOpen: false,

        setCurrentTrack: (track, context = null) =>
          set((s) => ({
            currentTrack: track,
            playbackContext: context,
            error: null,
            status: 'loading',
            bufferedTime: 0,
            queueGeneration: s.queueGeneration + 1,
          })),
        setPlaybackContext: (ctx) => set({ playbackContext: ctx }),
        setQueue: (songs, startIndex = 0) =>
          set((s) => ({
            queue: songs,
            queueIndex: startIndex,
            shuffleOrder: s.isShuffled ? fisherYates(songs.length) : [],
            queueGeneration: s.queueGeneration + 1,
          })),
        addToQueue: (song) =>
          set((s) => {
            const updated = [...s.queue, song];
            const updatedShuffle =
              s.isShuffled && s.shuffleOrder.length === s.queue.length
                ? [...s.shuffleOrder, updated.length - 1]
                : s.shuffleOrder;
            if (!s.currentTrack && s.queue.length === 0) {
              return {
                queue: updated,
                queueIndex: 0,
                currentTrack: song,
                status: 'loading',
                error: null,
                shuffleOrder: updatedShuffle,
                queueGeneration: s.queueGeneration + 1,
              };
            }
            return {
              queue: updated,
              shuffleOrder: updatedShuffle,
            };
          }),
        removeFromQueue: (index: number) => {
          const { queue, queueIndex } = get();
          if (index < 0 || index >= queue.length) return;

          if (queue.length <= 1) {
            set({ queue: [], queueIndex: 0, currentTrack: null, status: 'idle' });
            return;
          }

          const updated = queue.filter((_, i) => i !== index);

          if (index === queueIndex) {
            const nextTrack = updated[Math.min(index, updated.length - 1)];
            const nextIndex = Math.min(index, updated.length - 1);
            set((s) => ({
              queue: updated,
              queueIndex: nextIndex,
              currentTrack: nextTrack,
              status: 'loading',
              error: null,
              queueGeneration: s.queueGeneration + 1,
            }));
          } else if (index < queueIndex) {
            set({ queue: updated, queueIndex: queueIndex - 1 });
          } else {
            set({ queue: updated });
          }
        },
        clearQueue: () => {
          const { queue, queueIndex } = get();
          if (!queue.length) return;
          set({ queue: queue.slice(0, queueIndex + 1) });
        },
        moveQueueItem: (fromIndex: number, toIndex: number) => {
          const { queue, queueIndex } = get();
          if (
            fromIndex < 0 ||
            fromIndex >= queue.length ||
            toIndex < 0 ||
            toIndex >= queue.length ||
            fromIndex === toIndex
          ) {
            return;
          }

          const cloned = [...queue];
          const [moved] = cloned.splice(fromIndex, 1);
          cloned.splice(toIndex, 0, moved);

          let newQueueIndex = queueIndex;
          if (queueIndex === fromIndex) {
            newQueueIndex = toIndex;
          } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
            newQueueIndex = queueIndex - 1;
          } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
            newQueueIndex = queueIndex + 1;
          }

          set({ queue: cloned, queueIndex: newQueueIndex });
        },
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

            let order = get().shuffleOrder;
            if (!order || order.length !== queue.length) {
              order = fisherYates(queue.length);
            }
            const currentPos = order.indexOf(queueIndex);
            let nextPos = currentPos + 1;
            if (nextPos >= order.length) {
              order = fisherYates(queue.length);
              if (order[0] === queueIndex && order.length > 1) {
                [order[0], order[1]] = [order[1], order[0]];
              }
              nextPos = 0;
            }
            set({ shuffleOrder: order });
            next = order[nextPos];
            if (next === queueIndex && queue.length > 1) {
              next = (queueIndex + 1) % queue.length;
            }
          } else {
            next = queueIndex + 1;
            if (next >= queue.length) {
              if (repeatMode === 'all') {
                next = 0;
              } else {
                _attemptQueueFallback(get, set);
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
          if (typeof window !== 'undefined') {
            import('@/lib/audio/AudioManager')
              .then(({ audioManager }) => {
                if (!audioManager) return;
                const { status } = get();
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
            try {
              localStorage.setItem('sway_volume', String(safe));
            } catch {}
            import('@/lib/audio/AudioManager')
              .then(({ audioManager }) => audioManager?.setVolume(safe))
              .catch(() => {});
          }
          set({ volume: safe });
          if (get().isMuted && safe > 0) {
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('sway_muted', 'false');
              } catch {}
              import('@/lib/audio/AudioManager')
                .then(({ audioManager }) => audioManager?.setMuted(false))
                .catch(() => {});
            }
            set({ isMuted: false });
          }
        },
        setMuted: (m: boolean) => {
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('sway_muted', String(m));
            } catch {}
            import('@/lib/audio/AudioManager')
              .then(({ audioManager }) => audioManager?.setMuted(m))
              .catch(() => {});
          }
          set({ isMuted: m });
        },
        toggleShuffle: () =>
          set((s) => {
            const next = !s.isShuffled;
            return {
              isShuffled: next,
              shuffleOrder: next ? fisherYates(s.queue.length) : [],
            };
          }),
        cycleRepeat: () =>
          set((s) => ({
            repeatMode:
              s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none',
          })),
        setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
        toggleQueue: () => set((s) => ({ isQueueOpen: !s.isQueueOpen })),
        toggleLyrics: () => set((s) => ({ isLyricsOpen: !s.isLyricsOpen })),
        setSleepTimer: (active, remainingMs = 0) =>
          set({ sleepTimerActive: active, sleepTimerRemainingMs: remainingMs }),
        toggleShortcuts: () => set((s) => ({ isShortcutsOpen: !s.isShortcutsOpen })),
      }),
      {
        name: 'sway-player-v2',
        storage: createJSONStorage(() => safeStorage),
        version: 2,
        partialize: (state): PersistedState => ({
          currentTrack: state.currentTrack,
          queue: state.queue,
          shuffleOrder: state.shuffleOrder,
          queueIndex: state.queueIndex,
          repeatMode: state.repeatMode,
          isShuffled: state.isShuffled,
          volume: state.volume,
          isMuted: state.isMuted,
          currentTime: state.currentTime,
        }),
        onRehydrateStorage: () => (state) => {
          if (state) {
            // Reset volatile fields on hydration — do NOT auto-play
            state.status = 'idle';
            state.error = null;
            state.isQueueOpen = false;
            state.isLyricsOpen = false;
            state.bufferedTime = 0;
            state.duration = 0;
            state.sleepTimerActive = false;
            state.sleepTimerRemainingMs = 0;
            state.isShortcutsOpen = false;
          }
        },
        migrate: (persistedState, version) => {
          if (version < 2) {
            const s = persistedState as Partial<PersistedState>;
            return {
              ...s,
              shuffleOrder: [],
            } as PersistedState;
          }
          return persistedState as PersistedState;
        },
      }
    )
  )
);

/** Internal: attempt dynamic queue fallback when queue exhausted */
function _attemptQueueFallback(
  get: () => PlayerStore,
  set: (partial: Partial<PlayerStore> | ((s: PlayerStore) => Partial<PlayerStore>)) => void
) {
  const lastTrack = get().currentTrack;
  const reqGen = get().queueGeneration + 1;
  // Queue reached end: immediately transition to idle to prevent stuck loading states
  set({ status: 'idle', queueGeneration: reqGen });

  if (lastTrack?.id) {

    const handleNewTracks = (newSongs: Song[]) => {
      if (get().queueGeneration !== reqGen || get().currentTrack?.id !== lastTrack.id) {
        return;
      }
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
    };

    import('@/lib/api/queue')
      .then(async ({ getNextQueue, queueTrackToSong }) => {
        try {
          const tracks = await getNextQueue(lastTrack.id, 5);
          if (tracks && tracks.length > 0) {
            handleNewTracks(tracks.map(queueTrackToSong));
            return;
          }
        } catch {}

        // Fallback to RadioEngine
        try {
          const { resolveNextRadioQueue } = await import('@/lib/playback/RadioEngine');
          const radioSongs = await resolveNextRadioQueue(lastTrack, get().queue);
          if (radioSongs && radioSongs.length > 0) {
            handleNewTracks(radioSongs);
            return;
          }
        } catch {}

        if (get().queueGeneration === reqGen && get().currentTrack?.id === lastTrack.id) {
          set({ status: 'idle' });
        }
      })
      .catch(async () => {
        try {
          const { resolveNextRadioQueue } = await import('@/lib/playback/RadioEngine');
          const radioSongs = await resolveNextRadioQueue(lastTrack, get().queue);
          if (radioSongs && radioSongs.length > 0) {
            handleNewTracks(radioSongs);
            return;
          }
        } catch {}

        if (get().queueGeneration === reqGen && get().currentTrack?.id === lastTrack.id) {
          set({ status: 'idle' });
        }
      });
    return;
  }
  set({ status: 'idle' });
}
