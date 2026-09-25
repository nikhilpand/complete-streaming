'use client';
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { resolveMedia } from '@/lib/api/songs';
import { scheduleExtract, applyPalette } from '@/lib/color/colorExtractor';
import { artistNames, artUrl } from '@/lib/utils';

export function usePlayback() {
  const prevIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastStoreTime = useRef<number>(0);
  const retryCountRef = useRef<Record<string, number>>({});

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const setStatus = usePlayerStore((s) => s.setStatus);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setBufferedTime = usePlayerStore((s) => s.setBufferedTime);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const setError = usePlayerStore((s) => s.setError);
  const playNext = usePlayerStore((s) => s.playNext);

  // ── 1. Wire AudioManager events → store ──
  useEffect(() => {
    if (!audioManager) return;
    return audioManager.subscribe((ev) => {
      switch (ev.type) {
        case 'play':
          setStatus('playing');
          break;
        case 'pause':
          setStatus('paused');
          break;
        case 'loading':
          setStatus('loading');
          break;
        case 'canplay':
          if (!audioManager.paused) {
            setStatus('playing');
          }
          break;
        case 'progress':
          setBufferedTime(ev.bufferedTime);
          break;
        case 'timeupdate':
          // Throttle Zustand updates to 4Hz (250ms) to eliminate high-frequency React re-renders
          if (Math.abs(ev.currentTime - lastStoreTime.current) >= 0.25 || ev.currentTime === 0) {
            lastStoreTime.current = ev.currentTime;
            setCurrentTime(ev.currentTime);
            setDuration(ev.duration);
          }
          break;
        case 'ended':
          playNext();
          break;
        case 'volumechange':
          setVolume(ev.volume);
          setMuted(ev.muted);
          break;
        case 'error':
          // If error occurs mid-stream, attempt bounded recovery
          const track = usePlayerStore.getState().currentTrack;
          if (track && (retryCountRef.current[track.id] || 0) < 1) {
            retryCountRef.current[track.id] = 1;
            const resumePos = audioManager.currentTime;
            setStatus('loading');
            resolveMedia(track.id)
              .then(async (media) => {
                if (!media?.streams?.length) throw new Error('No streams');
                const best = [...media.streams].sort((a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0))[0];
                if (!best?.url) throw new Error('No stream URL');
                await audioManager.load(best.url);
                if (resumePos > 0) audioManager.seek(resumePos);
                await audioManager.play();
              })
              .catch(() => {
                setError(ev.message || 'Stream connection lost');
              });
          } else {
            setError(ev.message);
          }
          break;
      }
    });
  }, [setStatus, setCurrentTime, setDuration, setVolume, setMuted, setError, playNext]);

  // ── 2. MediaSession Projection (OS lock screen, Bluetooth, hardware keys) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const artistsStr = artistNames(currentTrack.artists, currentTrack.subtitle);
    const artworkUrl = artUrl(currentTrack.artwork_url);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title || 'Untitled',
      artist: artistsStr,
      album: currentTrack.album || '',
      artwork: artworkUrl
        ? [
            { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' },
            { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  }, [currentTrack]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
  }, [status]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;
    const store = usePlayerStore.getState;

    try {
      ms.setActionHandler('play', () => {
        store().play();
      });
      ms.setActionHandler('pause', () => {
        store().pause();
      });
      ms.setActionHandler('previoustrack', () => {
        store().playPrev();
      });
      ms.setActionHandler('nexttrack', () => {
        store().playNext();
      });
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && !isNaN(details.seekTime)) {
          store().seekTo(details.seekTime);
        }
      });
    } catch {
      // Some browsers don't support all mediaSession actions
    }

    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('previoustrack', null);
        ms.setActionHandler('nexttrack', null);
        ms.setActionHandler('seekto', null);
      } catch {}
    };
  }, []);

  // ── 3. Load + play when currentTrack changes (with single bounded retry) ──
  useEffect(() => {
    if (!currentTrack || !audioManager) return;
    if (currentTrack.id === prevIdRef.current) return;
    prevIdRef.current = currentTrack.id;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus('loading');
    setError(null);

    // Color extraction
    if (currentTrack.artwork_url) {
      scheduleExtract(currentTrack.artwork_url, applyPalette);
    }

    const attemptLoad = (isRetry = false) => {
      resolveMedia(currentTrack.id, ac.signal)
        .then(async (media) => {
          if (ac.signal.aborted) return;
          if (!media?.streams?.length) {
            setError("Couldn't start playback. No audio streams found for this track.");
            prevIdRef.current = null;
            return;
          }
          const best = [...media.streams].sort((a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0))[0];
          if (!best?.url) {
            setError("Stream URL unavailable.");
            prevIdRef.current = null;
            return;
          }
          try {
            await audioManager.load(best.url);
            await audioManager.play();
          } catch (err: unknown) {
            const e = err as Error;
            if (e.name === 'NotAllowedError') {
              setStatus('paused');
              return;
            }
            throw err;
          }
        })
        .catch((err) => {
          if (ac.signal.aborted || err?.name === 'AbortError') return;
          if (!isRetry && (retryCountRef.current[currentTrack.id] || 0) < 1) {
            retryCountRef.current[currentTrack.id] = 1;
            attemptLoad(true);
            return;
          }
          console.error('Playback error:', err);
          prevIdRef.current = null;
          setError("Couldn't start playback: " + (err?.message || 'Check network connection'));
        });
    };

    attemptLoad(false);

    return () => {
      ac.abort();
    };
  }, [currentTrack, setStatus, setError]);
}
