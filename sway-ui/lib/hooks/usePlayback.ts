'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { resolveMedia } from '@/lib/api/songs';
import { sendTelemetry } from '@/lib/api/telemetry';
import { scheduleExtract, applyPalette } from '@/lib/color/colorExtractor';
import { artistNames, artUrl } from '@/lib/utils';
import type { Song } from '@/lib/api/types';

export function usePlayback() {
  const prevIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastStoreTime = useRef<number>(0);
  const retryCountRef = useRef<Record<string, number>>({});

  // Telemetry milestone tracking
  const milestonesFiredRef = useRef<Record<string, boolean>>({});
  const playheadRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const activeTrackRef = useRef<Song | null>(null);
  const activeContextRef = useRef<{ source?: string; query?: string } | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const status = usePlayerStore((s) => s.status);
  const setStatus = usePlayerStore((s) => s.setStatus);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setBufferedTime = usePlayerStore((s) => s.setBufferedTime);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const setError = usePlayerStore((s) => s.setError);
  const playNext = usePlayerStore((s) => s.playNext);

  // Keep activeContextRef synced
  useEffect(() => {
    activeContextRef.current = playbackContext;
  }, [playbackContext]);

  // ── 1. Wire AudioManager events → store & telemetry ──
  useEffect(() => {
    if (!audioManager) return;
    return audioManager.subscribe((ev) => {
      switch (ev.type) {
        case 'play':
          setStatus('playing');
          const pTrack = activeTrackRef.current;
          if (pTrack && !milestonesFiredRef.current.play_started) {
            milestonesFiredRef.current.play_started = true;
            sendTelemetry({
              event_type: 'play_started',
              track_id: pTrack.id,
              position_ms: Math.round(audioManager.currentTime * 1000) || 0,
              duration_ms: Math.round((audioManager.duration || 0) * 1000) || pTrack.duration_ms,
              source: activeContextRef.current?.source,
              query: activeContextRef.current?.query,
            });
          }
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
          playheadRef.current = ev.currentTime;
          durationRef.current = ev.duration;

          // Milestone Telemetry
          const track = activeTrackRef.current;
          if (track) {
            if (ev.currentTime >= 10 && !milestonesFiredRef.current.play_10s) {
              milestonesFiredRef.current.play_10s = true;
              sendTelemetry({
                event_type: 'play_10s',
                track_id: track.id,
                position_ms: Math.round(ev.currentTime * 1000),
                duration_ms: Math.round(ev.duration * 1000),
                source: activeContextRef.current?.source,
                query: activeContextRef.current?.query,
              });
            }
            if (ev.currentTime >= 30 && !milestonesFiredRef.current.play_30s) {
              milestonesFiredRef.current.play_30s = true;
              sendTelemetry({
                event_type: 'play_30s',
                track_id: track.id,
                position_ms: Math.round(ev.currentTime * 1000),
                duration_ms: Math.round(ev.duration * 1000),
                source: activeContextRef.current?.source,
                query: activeContextRef.current?.query,
              });
            }
            if (
              ev.duration > 0 &&
              ev.currentTime >= ev.duration * 0.5 &&
              !milestonesFiredRef.current.play_50pct
            ) {
              milestonesFiredRef.current.play_50pct = true;
              sendTelemetry({
                event_type: 'play_50pct',
                track_id: track.id,
                position_ms: Math.round(ev.currentTime * 1000),
                duration_ms: Math.round(ev.duration * 1000),
                completion_ratio: ev.currentTime / ev.duration,
                source: activeContextRef.current?.source,
                query: activeContextRef.current?.query,
              });
            }
          }

          // Throttle Zustand updates to 4Hz (250ms) to eliminate high-frequency React re-renders
          if (Math.abs(ev.currentTime - lastStoreTime.current) >= 0.25 || ev.currentTime === 0) {
            lastStoreTime.current = ev.currentTime;
            setCurrentTime(ev.currentTime);
            setDuration(ev.duration);
          }
          break;
        case 'ended':
          const endedTrack = activeTrackRef.current;
          if (endedTrack && !milestonesFiredRef.current.completed) {
            milestonesFiredRef.current.completed = true;
            sendTelemetry({
              event_type: 'completed',
              track_id: endedTrack.id,
              position_ms: Math.round(playheadRef.current * 1000),
              duration_ms: Math.round(durationRef.current * 1000),
              completion_ratio: 1.0,
              source: activeContextRef.current?.source,
              query: activeContextRef.current?.query,
            });
          }
          playNext();
          break;
        case 'volumechange':
          setVolume(ev.volume);
          setMuted(ev.muted);
          break;
        case 'error':
          // If error occurs mid-stream, attempt bounded recovery
          const cur = usePlayerStore.getState().currentTrack;
          if (cur && (retryCountRef.current[cur.id] || 0) < 1) {
            retryCountRef.current[cur.id] = 1;
            const resumePos = audioManager.currentTime;
            setStatus('loading');
            resolveMedia(cur.id)
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
    navigator.mediaSession.playbackState =
      status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
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
      // Browser compatibility
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

  // ── 3. Load + play when currentTrack changes (with skip telemetry tracking) ──
  useEffect(() => {
    if (!currentTrack || !audioManager) return;
    if (currentTrack.id === prevIdRef.current) return;

    // Check skip telemetry on previous track
    const prevTrack = activeTrackRef.current;
    if (prevTrack && !milestonesFiredRef.current.completed) {
      const pos = playheadRef.current;
      if (pos > 0.5 && pos < 10) {
        sendTelemetry({
          event_type: 'skip_lt_10s',
          track_id: prevTrack.id,
          position_ms: Math.round(pos * 1000),
          duration_ms: Math.round(durationRef.current * 1000),
          source: activeContextRef.current?.source,
          query: activeContextRef.current?.query,
        });
      } else if (pos >= 10 && pos < 30) {
        sendTelemetry({
          event_type: 'skip_10_30s',
          track_id: prevTrack.id,
          position_ms: Math.round(pos * 1000),
          duration_ms: Math.round(durationRef.current * 1000),
          source: activeContextRef.current?.source,
          query: activeContextRef.current?.query,
        });
      }
    }

    // Reset milestone state for new track
    activeTrackRef.current = currentTrack;
    milestonesFiredRef.current = {};
    playheadRef.current = 0;
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
