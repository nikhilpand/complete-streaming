'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { artistNames } from '@/lib/utils';

export interface RecommendationTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  mood?: string;
  score?: number;
  source?: string;
  explanation?: string;
  badge?: string;
  artwork_url?: string;
}

export function usePlaybackTelemetry(userId: string = 'guest_user') {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const isPlaying = status === 'playing';
  const trackId = currentTrack?.id || null;
  const trackDuration = duration || (currentTrack?.duration_ms ? currentTrack.duration_ms / 1000 : 180);
  const trackTitle = currentTrack?.title || '';
  const trackArtist = currentTrack ? artistNames(currentTrack.artists, currentTrack.subtitle) : '';
  const trackAlbum = currentTrack?.album || '';

  const lastTrackId = useRef<string | null>(null);
  const playLogged = useRef(false);
  const completeLogged = useRef(false);
  const trackStartTime = useRef<number>(0);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const sendEvent = useCallback(
    async (
      type: string,
      customTrack?: {
        id: string;
        title: string;
        artist: string;
        album?: string;
      }
    ) => {
      const activeId = customTrack?.id || trackId;
      if (!activeId) return;

      const title = customTrack?.title ?? trackTitle;
      const artist = customTrack?.artist ?? trackArtist;
      const album = customTrack?.album ?? trackAlbum ?? 'Single';

      try {
        await fetch('/api/proxy/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            track_id: activeId,
            type,
            title,
            artist,
            album,
            position_ms: Math.round(currentTimeRef.current * 1000),
            duration_ms: Math.round(trackDuration * 1000),
          }),
        });
      } catch {
        // Silently tolerate network glitches
      }
    },
    [trackId, trackTitle, trackArtist, trackAlbum, trackDuration, userId]
  );

  // Track playback start and track transitions
  useEffect(() => {
    if (!trackId) return;

    if (trackId !== lastTrackId.current) {
      // If previous track wasn't finished and was played < 30s, record skip
      if (lastTrackId.current && !completeLogged.current && trackStartTime.current > 0) {
        const playedSec = (Date.now() - trackStartTime.current) / 1000;
        if (playedSec > 3 && playedSec < 30) {
          sendEvent('skip', {
            id: lastTrackId.current,
            title: '',
            artist: '',
          });
        }
      }

      lastTrackId.current = trackId;
      playLogged.current = false;
      completeLogged.current = false;
      trackStartTime.current = Date.now();
    }

    if (isPlaying && !playLogged.current) {
      playLogged.current = true;
      sendEvent('play');
    }
  }, [trackId, isPlaying, sendEvent]);

  // Track completion (> 95% of duration)
  useEffect(() => {
    if (!trackDuration || trackDuration <= 0 || !isPlaying) return;
    if (currentTime >= trackDuration * 0.95 && !completeLogged.current) {
      completeLogged.current = true;
      sendEvent('play_completed');
    }
  }, [currentTime, trackDuration, isPlaying, sendEvent]);

  const logLike = useCallback(() => {
    sendEvent('like');
  }, [sendEvent]);

  const logUnlike = useCallback(() => {
    sendEvent('unlike');
  }, [sendEvent]);

  const logSkip = useCallback(() => {
    sendEvent('skip');
  }, [sendEvent]);

  return {
    sendEvent,
    logLike,
    logUnlike,
    logSkip,
  };
}
