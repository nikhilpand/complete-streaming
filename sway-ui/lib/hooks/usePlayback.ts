'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { resolveMedia, prefetchMedia, getPlayableStreamUrl } from '@/lib/api/songs';
import { sendTelemetry } from '@/lib/api/telemetry';
import { scheduleExtract, applyPalette } from '@/lib/color/colorExtractor';
import { artistNames, artUrl } from '@/lib/utils';
import { prefetchLyrics } from '@/lib/lyricsCache';
import { useRecentHistory } from '@/store/useRecentHistory';
import { scrobbleTrack } from '@/lib/scrobbler';
import type { Song } from '@/lib/api/types';

function getTrackMeta(t: Song | null) {
  if (!t) return {};
  const artistName = artistNames(t.artists, t.subtitle);
  const artistId = t.artists?.[0]?.id || (artistName ? artistName.toLowerCase().replace(/[^a-z0-9]+/g, '_') : undefined);
  return {
    title: t.title,
    artist: artistName,
    artist_id: artistId,
    artwork_url: t.artwork_url,
  };
}

export function usePlayback() {
  const prevIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastStoreTime = useRef<number>(0);
  const playbackGenRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);

  // Telemetry milestone tracking
  const milestonesFiredRef = useRef<Record<string, boolean>>({});
  const playheadRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const activeTrackRef = useRef<Song | null>(null);
  const activeContextRef = useRef<{ source?: string; query?: string } | null>(null);
  const nextTrackPrefetchedRef = useRef<string | null>(null);

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
  const repeatMode = usePlayerStore((s) => s.repeatMode);

  // Keep activeContextRef synced
  useEffect(() => {
    activeContextRef.current = playbackContext;
  }, [playbackContext]);

  // Sync repeatMode with AudioEngine (defense in depth)
  useEffect(() => {
    if (audioManager) {
      audioManager.setRepeatMode(repeatMode);
      if (repeatMode === 'one') {
        audioManager.clearStandby();
      }
    }
  }, [repeatMode]);

  // ── 1. Wire AudioManager events → store & telemetry ──
  useEffect(() => {
    if (!audioManager) return;
    return audioManager.subscribe((ev) => {
      switch (ev.type) {
        case 'play':
          setStatus('playing');
          const pTrack = activeTrackRef.current;
          if (pTrack) {
            useRecentHistory.getState().addHistory(pTrack);
            if (!milestonesFiredRef.current.play_started) {
              milestonesFiredRef.current.play_started = true;
              sendTelemetry({
                event_type: 'play_started',
                track_id: pTrack.id,
                ...getTrackMeta(pTrack),
                position_ms: Math.round(audioManager.currentTime * 1000) || 0,
                duration_ms: Math.round((audioManager.duration || 0) * 1000) || pTrack.duration_ms,
                source: activeContextRef.current?.source,
                query: activeContextRef.current?.query,
              });
            }
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
            // Prefetch upcoming track media and lyrics once current song playback stabilizes
            if (ev.currentTime >= 5 && !milestonesFiredRef.current.prefetch_next) {
              milestonesFiredRef.current.prefetch_next = true;
              const { queue, queueIndex } = usePlayerStore.getState();
              const nextSong = queue[queueIndex + 1];
              if (nextSong) {
                prefetchMedia(nextSong.id, {
                  title: nextSong.title,
                  artist: artistNames(nextSong.artists, nextSong.subtitle),
                });
                prefetchLyrics(nextSong);
              }
            }
            if (ev.currentTime >= 10 && !milestonesFiredRef.current.play_10s) {
              milestonesFiredRef.current.play_10s = true;
              sendTelemetry({
                event_type: 'play_10s',
                track_id: track.id,
                ...getTrackMeta(track),
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
                ...getTrackMeta(track),
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
                ...getTrackMeta(track),
                position_ms: Math.round(ev.currentTime * 1000),
                duration_ms: Math.round(ev.duration * 1000),
                completion_ratio: ev.currentTime / ev.duration,
                source: activeContextRef.current?.source,
                query: activeContextRef.current?.query,
              });
              scrobbleTrack(track, Math.floor(Date.now() / 1000) - Math.floor(ev.currentTime));
            }
          }

          // Pre-resolve next track 15s before track end for zero-latency gapless / crossfade transition
          if (
            ev.duration > 20 &&
            ev.duration - ev.currentTime <= 15 &&
            nextTrackPrefetchedRef.current !== track?.id
          ) {
            nextTrackPrefetchedRef.current = track?.id || null;
            const { queue, queueIndex, isShuffled, shuffleOrder, repeatMode } = usePlayerStore.getState();
            if (repeatMode === 'one') {
              // Invariant: Do not prefetch next track if repeating current track
              return;
            }
            let nextIndex = -1;
            if (isShuffled && shuffleOrder && shuffleOrder.length === queue.length) {
              const currentPos = shuffleOrder.indexOf(queueIndex);
              if (currentPos >= 0 && currentPos + 1 < shuffleOrder.length) {
                nextIndex = shuffleOrder[currentPos + 1];
              }
            } else if (queueIndex + 1 < queue.length) {
              nextIndex = queueIndex + 1;
            } else if (repeatMode === 'all') {
              nextIndex = 0;
            }

            if (nextIndex >= 0 && queue[nextIndex]) {
              const nextTrack = queue[nextIndex];
              const nextMeta = {
                title: nextTrack.title,
                artist: artistNames(nextTrack.artists, nextTrack.subtitle),
              };
              resolveMedia(nextTrack.id, undefined, nextMeta)
                .then((media) => {
                  if (media?.streams?.length) {
                    const best = [...media.streams].sort(
                      (a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0)
                    )[0];
                    if (best?.url) {
                      audioManager.preload(best.url, nextTrack.id);
                    }
                  }
                })
                .catch(() => {});
              prefetchLyrics(nextTrack);
            }
          }

          // Throttle Zustand updates to 4Hz (250ms) to eliminate high-frequency React re-renders
          if (Math.abs(ev.currentTime - lastStoreTime.current) >= 0.25 || ev.currentTime === 0) {
            lastStoreTime.current = ev.currentTime;
            setCurrentTime(ev.currentTime);
            setDuration(ev.duration);

            // Sync OS lockscreen / MediaSession position state
            if (
              typeof window !== 'undefined' &&
              'mediaSession' in navigator &&
              'setPositionState' in navigator.mediaSession &&
              ev.duration > 0 &&
              ev.currentTime <= ev.duration
            ) {
              try {
                navigator.mediaSession.setPositionState({
                  duration: Math.max(0, ev.duration),
                  playbackRate: 1,
                  position: Math.min(Math.max(0, ev.currentTime), ev.duration),
                });
              } catch {}
            }
          }
          break;
        case 'transition_start':
          setStatus('transitioning');
          break;
        case 'transition_end': {
          const completedTrack = activeTrackRef.current;
          if (completedTrack && !milestonesFiredRef.current.completed) {
            milestonesFiredRef.current.completed = true;
            sendTelemetry({
              event_type: 'completed',
              track_id: completedTrack.id,
              ...getTrackMeta(completedTrack),
              position_ms: Math.round((durationRef.current || playheadRef.current) * 1000),
              duration_ms: Math.round((durationRef.current || 0) * 1000) || completedTrack.duration_ms,
              completion_ratio: 1.0,
              source: activeContextRef.current?.source,
              query: activeContextRef.current?.query,
            });
          }
          const state = usePlayerStore.getState();
          if (state.repeatMode === 'one') break;
          state.playNext();
          break;
        }
        case 'ended':
          const endedTrack = activeTrackRef.current;
          if (endedTrack && !milestonesFiredRef.current.completed) {
            milestonesFiredRef.current.completed = true;
            sendTelemetry({
              event_type: 'completed',
              track_id: endedTrack.id,
              ...getTrackMeta(endedTrack),
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
          // Stale stream errors from an old track must NEVER reload a newer current track
          const curGen = playbackGenRef.current;
          const expectedTrack = activeTrackRef.current;
          const storeTrack = usePlayerStore.getState().currentTrack;

          // Guard: Only handle error if active track matches the store current track
          if (!expectedTrack || !storeTrack || expectedTrack.id !== storeTrack.id) {
            return;
          }

          // Retry budget belongs to the playback attempt/generation (max 1 retry per attempt)
          if (retryCountRef.current < 1) {
            retryCountRef.current += 1;
            const resumePos = audioManager.currentTime;
            const retryMeta = {
              title: storeTrack.title,
              artist: artistNames(storeTrack.artists, storeTrack.subtitle),
            };
            setStatus('loading');
            resolveMedia(storeTrack.id, undefined, retryMeta)
              .then(async (media) => {
                if (playbackGenRef.current !== curGen || usePlayerStore.getState().currentTrack?.id !== storeTrack.id) {
                  return;
                }
                if (!media?.streams?.length) throw new Error('No streams');
                const best = [...media.streams].sort((a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0))[0];
                if (!best?.url) throw new Error('No stream URL');
                await audioManager.load(best.url);
                if (playbackGenRef.current !== curGen) return;
                if (resumePos > 0) audioManager.seek(resumePos);
                await audioManager.play();
              })
              .catch(() => {
                if (playbackGenRef.current !== curGen) return;
                setError(ev.message || 'Stream connection lost');
              });
          } else {
            setError(ev.message);
          }
          break;
      }
    });
  }, [setStatus, setCurrentTime, setBufferedTime, setDuration, setVolume, setMuted, setError, playNext]);

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
      ms.setActionHandler('seekbackward', (details) => {
        const skip = details.seekOffset || 10;
        const cur = audioManager?.currentTime ?? store().currentTime;
        store().seekTo(Math.max(0, cur - skip));
      });
      ms.setActionHandler('seekforward', (details) => {
        const skip = details.seekOffset || 10;
        const cur = audioManager?.currentTime ?? store().currentTime;
        const dur = audioManager?.duration ?? store().duration;
        store().seekTo(Math.min(dur || 9999, cur + skip));
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
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
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
          ...getTrackMeta(prevTrack),
          position_ms: Math.round(pos * 1000),
          duration_ms: Math.round(durationRef.current * 1000),
          source: activeContextRef.current?.source,
          query: activeContextRef.current?.query,
        });
      } else if (pos >= 10 && pos < 30) {
        sendTelemetry({
          event_type: 'skip_10_30s',
          track_id: prevTrack.id,
          ...getTrackMeta(prevTrack),
          position_ms: Math.round(pos * 1000),
          duration_ms: Math.round(durationRef.current * 1000),
          source: activeContextRef.current?.source,
          query: activeContextRef.current?.query,
        });
      }
    }

    const generation = ++playbackGenRef.current;
    retryCountRef.current = 0;

    // If active pipeline is already playing this track (via gapless / crossfade transition swap),
    // smoothly update metadata and milestones without reloading or interrupting audio!
    if (audioManager.activePipeline?.trackId === currentTrack.id && !audioManager.paused) {
      activeTrackRef.current = currentTrack;
      milestonesFiredRef.current = {};
      playheadRef.current = audioManager.currentTime;
      prevIdRef.current = currentTrack.id;
      setStatus('playing');
      setError(null);
      if (currentTrack.artwork_url) {
        scheduleExtract(currentTrack.artwork_url, applyPalette);
      }
      prefetchLyrics(currentTrack);
      nextTrackPrefetchedRef.current = null;
      return;
    }

    // Cancel any in-flight transitions from previous tracks
    audioManager.cancelTransition();

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

    // Background lyrics prefetch — so opening lyrics panel is instant (0ms, no spinner)
    prefetchLyrics(currentTrack);
    nextTrackPrefetchedRef.current = null;

    const attemptLoad = async (isRetry = false) => {
      // 1. Check local offline audio cache (IndexedDB) first for instant offline/0ms playback
      try {
        const { getCachedAudio } = await import('@/lib/audioCache');
        const cached = await getCachedAudio(currentTrack.id);
        if (cached?.objectUrl) {
          if (ac.signal.aborted || playbackGenRef.current !== generation) return;
          await audioManager.load(cached.objectUrl, currentTrack.id);
          if (ac.signal.aborted || playbackGenRef.current !== generation) return;
          await audioManager.play();
          return;
        }
      } catch {}

      // 2. Network media resolution
      const trackMeta = {
        title: currentTrack.title,
        artist: artistNames(currentTrack.artists, currentTrack.subtitle),
      };

      resolveMedia(currentTrack.id, ac.signal, trackMeta)
        .then(async (media) => {
          if (ac.signal.aborted || playbackGenRef.current !== generation) return;
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
            await audioManager.load(best.url, currentTrack.id);
            if (ac.signal.aborted || playbackGenRef.current !== generation) return;
            await audioManager.play();

            // Background populate cache for fast repeat plays
            import('@/lib/audioCache').then(async ({ cacheAudio, isAudioCached }) => {
              const alreadyCached = await isAudioCached(currentTrack.id);
              if (!alreadyCached && best.url) {
                const streamUrl = getPlayableStreamUrl(best.url);
                fetch(streamUrl)
                  .then((res) => (res.ok ? res.blob() : null))
                  .then((blob) => {
                    if (blob) cacheAudio(currentTrack.id, blob, best.mime_type || 'audio/mp4');
                  })
                  .catch(() => {});
              }
            }).catch(() => {});
          } catch (err: unknown) {
            if (ac.signal.aborted || playbackGenRef.current !== generation) return;
            const e = err as Error;
            if (e.name === 'NotAllowedError') {
              setStatus('paused');
              return;
            }
            throw err;
          }
        })
        .catch((err) => {
          if (ac.signal.aborted || err?.name === 'AbortError' || playbackGenRef.current !== generation) return;
          if (!isRetry && retryCountRef.current < 1) {
            retryCountRef.current = 1;
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
