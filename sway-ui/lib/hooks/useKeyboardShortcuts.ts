'use client';

import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';

/**
 * useKeyboardShortcuts — Sprint 1
 *
 * Global keyboard handler. Guards against input/textarea/contenteditable.
 * Shortcuts:
 *   Space / K       — play/pause
 *   ← / J           — seek -5s
 *   → / L           — seek +5s
 *   Shift+← / <     — previous track
 *   Shift+→ / >     — next track
 *   ↑               — volume +5%
 *   ↓               — volume -5%
 *   M               — mute toggle
 *   S               — shuffle toggle
 *   R               — cycle repeat
 *   F               — toggle fullscreen lyrics
 *   /               — open search (browser default allowed)
 *   ?               — shortcuts modal
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Guard: ignore when typing in inputs
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      // Guard: ignore browser-level shortcuts
      if (e.metaKey || e.ctrlKey) return;

      const store = usePlayerStore.getState();
      const curTime = audioManager?.currentTime ?? store.currentTime;
      const dur = store.duration || 99999;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!store.currentTrack) return;
        if (e.shiftKey) {
          // Shift+← / Shift+→ = prev/next track
          e.preventDefault();
          if (e.key === 'ArrowLeft') store.playPrev();
          else store.playNext();
        } else {
          // ← / → = seek ±5s
          e.preventDefault();
          if (e.key === 'ArrowLeft') store.seekTo(Math.max(0, curTime - 5));
          else store.seekTo(Math.min(dur, curTime + 5));
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        store.setVolume(Math.min(1, store.volume + 0.05));
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        store.setVolume(Math.max(0, store.volume - 0.05));
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          if (!store.currentTrack) return;
          e.preventDefault();
          store.togglePlayPause();
          break;

        // J = seek -10s, j = seek -5s  (same key, no shift in standard convention)
        // We use J for -10 and j for -5 to match vim-style
        case 'j':
          if (!store.currentTrack) return;
          e.preventDefault();
          store.seekTo(Math.max(0, curTime - 5));
          break;
        case 'J':
          if (!store.currentTrack) return;
          e.preventDefault();
          store.seekTo(Math.max(0, curTime - 10));
          break;

        case 'l':
          if (!store.currentTrack) return;
          e.preventDefault();
          store.seekTo(Math.min(dur, curTime + 5));
          break;
        case 'L':
          if (!store.currentTrack) return;
          e.preventDefault();
          store.seekTo(Math.min(dur, curTime + 10));
          break;

        case 'm':
        case 'M':
          store.setMuted(!store.isMuted);
          break;

        case 's':
        case 'S':
          store.toggleShuffle();
          break;

        case 'r':
        case 'R':
          store.cycleRepeat();
          break;

        case 'f':
        case 'F':
          if (store.currentTrack) store.toggleLyrics();
          break;

        case 'e':
        case 'E':
          usePlayerStore.getState(); // ensure initialized
          import('@/store/useAudioSettings').then(({ useAudioSettings }) => {
            useAudioSettings.getState().toggleEqualizerModal();
          });
          break;

        case '?':
          e.preventDefault();
          store.toggleShortcuts();
          break;

        // '/' is handled by SearchCommand — don't intercept
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
