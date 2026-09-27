/**
 * Zustand store for karaoke UI state.
 *
 * Responsibilities:
 * - Track current karaoke mode (original / karaoke / sing)
 * - Manage preparation lifecycle (polling status)
 * - Expose actions: setMode, setVocalVolume, prepareForTrack
 *
 * Does NOT own audio playback — that stays in AudioManager.
 * Does NOT own player state — that stays in playerStore.
 */
'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { KaraokeMode, KaraokeState, KaraokeStatus } from './types';
import { getKaraokeStatus, prepareKaraoke, pollKaraokeStatus, getStemStreamUrl } from './api';
import { karaokeEngine } from './KaraokeEngine';

interface KaraokeStore extends KaraokeState {
  /** Set karaoke mode. Will activate/deactivate the engine. */
  setMode: (mode: KaraokeMode) => void;
  /** Set vocal volume (0.0–1.0). Only meaningful in 'sing' mode. */
  setVocalVolume: (v: number) => void;
  /** Trigger karaoke preparation for a track, given its stream URL. */
  prepareForTrack: (trackId: string, streamUrl: string, canonicalTrackKey?: string) => Promise<void>;
  /** Reset karaoke state when track changes. */
  reset: () => void;
}

const INITIAL_STATE: KaraokeState = {
  mode: 'original',
  status: 'not_prepared',
  progress: 0,
  ready: false,
  vocalVolume: 1.0,
  error: undefined,
  trackId: null,
};

let _pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export const useKaraokeStore = create<KaraokeStore>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    setMode: (mode: KaraokeMode) => {
      const { ready } = get();
      if (mode !== 'original' && !ready) {
        // Can't enter karaoke/sing without stems ready
        return;
      }
      set({ mode });
      karaokeEngine?.setMode(mode);
    },

    setVocalVolume: (v: number) => {
      set({ vocalVolume: Math.max(0, Math.min(1, v)) });
      karaokeEngine?.setVocalVolume(v);
    },

    prepareForTrack: async (trackId: string, streamUrl: string, canonicalTrackKey?: string) => {
      const { trackId: currentTrackId } = get();
      if (currentTrackId === trackId) {
        // Already preparing or ready for this track
        const { status } = get();
        if (status === 'ready' || status === 'processing' || status === 'queued') return;
      }

      // Reset for new track
      stopPolling();
      set({ ...INITIAL_STATE, trackId, status: 'queued', progress: 0 });
      karaokeEngine?.deactivate();

      try {
        // Check existing status first
        const info = await getKaraokeStatus(trackId);
        if (info.status === 'ready') {
          await _onReady(trackId, set);
          return;
        }
        if (info.status === 'processing' || info.status === 'queued') {
          set({ status: info.status, progress: info.progress });
          _startPolling(trackId, set);
          return;
        }
        if (info.status === 'failed') {
          set({ status: 'failed', error: info.error || 'Preparation failed' });
          return;
        }

        // Not prepared yet — trigger preparation
        const prepared = await prepareKaraoke(trackId, streamUrl, canonicalTrackKey);
        set({ status: prepared.status as KaraokeStatus, progress: prepared.progress });

        if (prepared.status === 'ready') {
          await _onReady(trackId, set);
        } else if (prepared.status === 'failed') {
          set({ status: 'failed', error: prepared.error || 'Preparation failed' });
        } else {
          _startPolling(trackId, set);
        }
      } catch (e) {
        set({ status: 'failed', error: (e as Error).message || 'Karaoke preparation error' });
      }
    },

    reset: () => {
      stopPolling();
      karaokeEngine?.deactivate();
      set({ ...INITIAL_STATE });
    },
  }))
);

function _startPolling(trackId: string, set: (s: Partial<KaraokeStore>) => void) {
  stopPolling();
  _pollTimer = setInterval(async () => {
    const { trackId: currentId } = useKaraokeStore.getState();
    if (currentId !== trackId) {
      stopPolling();
      return;
    }
    try {
      const info = await pollKaraokeStatus(trackId);
      set({ status: info.status as KaraokeStatus, progress: info.progress });
      if (info.status === 'ready') {
        stopPolling();
        await _onReady(trackId, set);
      } else if (info.status === 'failed') {
        stopPolling();
        set({ status: 'failed', error: info.error || 'Preparation failed' });
      }
    } catch {
      // Transient polling error — keep polling
    }
  }, 3000);
}

async function _onReady(trackId: string, set: (s: Partial<KaraokeStore>) => void) {
  set({ status: 'ready', ready: true, progress: 1.0 });
  // Pre-load stems into the engine
  const vocalsUrl = getStemStreamUrl(trackId, 'vocals');
  const instrumentalUrl = getStemStreamUrl(trackId, 'instrumental');
  try {
    await karaokeEngine?.loadStems(trackId, vocalsUrl, instrumentalUrl);
  } catch (e) {
    set({ status: 'failed', ready: false, error: 'Failed to load stem audio: ' + (e as Error).message });
  }
}
