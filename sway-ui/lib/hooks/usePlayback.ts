'use client';
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { resolveMedia } from '@/lib/api/songs';
import { scheduleExtract, applyPalette } from '@/lib/color/colorExtractor';

export function usePlayback() {
  const prevIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const setStatus = usePlayerStore((s) => s.setStatus);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const setError = usePlayerStore((s) => s.setError);
  const playNext = usePlayerStore((s) => s.playNext);

  // Wire AudioManager events → store
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
        case 'timeupdate':
          setCurrentTime(ev.currentTime);
          setDuration(ev.duration);
          break;
        case 'ended':
          playNext();
          break;
        case 'volumechange':
          setVolume(ev.volume);
          setMuted(ev.muted);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    });
  }, [setStatus, setCurrentTime, setDuration, setVolume, setMuted, setError, playNext]);

  // Load + play when currentTrack changes
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
            // Autoplay policy paused it: track is ready, user can click play
            setStatus('paused');
            return;
          }
          throw err;
        }
      })
      .catch((err) => {
        if (ac.signal.aborted || err?.name === 'AbortError') return;
        console.error('Playback error:', err);
        prevIdRef.current = null;
        setError("Couldn't start playback: " + (err?.message || 'Check network connection'));
      });

    return () => {
      ac.abort();
    };
  }, [currentTrack, setStatus, setError]);
}
