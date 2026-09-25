import { useCallback } from 'react';
import { usePlayerStore } from './playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { artistNames } from '@/lib/utils';

export function useAudioPlayer() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrev = usePlayerStore((s) => s.playPrev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  const togglePlayPause = useCallback(() => {
    if (!audioManager) return;
    if (status === 'playing') {
      audioManager.pause();
    } else {
      audioManager.play().catch(() => {});
    }
  }, [status]);

  const seekTo = useCallback((timeSec: number) => {
    if (!audioManager || typeof timeSec !== 'number' || isNaN(timeSec)) return;
    audioManager.seek(timeSec);
    usePlayerStore.getState().setCurrentTime(timeSec);
  }, []);

  return {
    currentTrack: currentTrack
      ? {
          id: currentTrack.id,
          videoId: currentTrack.id,
          title: currentTrack.title || '',
          artist: artistNames(currentTrack.artists, currentTrack.subtitle),
          thumbnail: currentTrack.artwork_url || '',
          album: currentTrack.album || (currentTrack.subtitle?.split(/\s*[·•|]\s*/)[0]?.trim()) || '',
          subtitle: currentTrack.subtitle || '',
          lyricsId: currentTrack.lyrics_id,
          hasLyrics: currentTrack.has_lyrics,
          duration: currentTrack.duration_ms ? currentTrack.duration_ms / 1000 : 0,
        }
      : null,
    isPlaying,
    isLoading,
    togglePlayPause,
    skipNext: playNext,
    skipPrev: playPrev,
    seekTo,
    shuffle: isShuffled,
    repeat: repeatMode === 'none' ? 'off' : repeatMode,
    toggleShuffle,
    cycleRepeat,
    toggleLyrics,
    _audio: typeof window !== 'undefined' ? audioManager?.audioElement ?? null : null,
  };
}
