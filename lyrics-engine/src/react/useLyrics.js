/**
 * useLyrics.js - React Hook for @levelup/lyrics-engine
 * Seamlessly binds audio player timeline to multi-provider synchronized lyrics.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { LyricsEngine } from '../engine/LyricsEngine.js';

export function useLyrics({ track, currentTimeMs = 0, isPlaying = false }) {
  const [lyrics, setLyrics] = useState(null);
  const [activeLine, setActiveLine] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState('');
  const [offsetMs, setOffsetMsState] = useState(0);

  const engineRef = useRef(null);

  // Initialize engine once
  if (!engineRef.current) {
    engineRef.current = new LyricsEngine();
  }

  const engine = engineRef.current;

  // Listen to engine events
  useEffect(() => {
    const unsubLoading = engine.on('loading', () => {
      setIsLoading(true);
      setError(null);
    });

    const unsubLoaded = engine.on('lyricsLoaded', (loadedLyrics) => {
      setIsLoading(false);
      setLyrics(loadedLyrics);
      setProvider(loadedLyrics.provider || 'Synced');
      setError(null);
    });

    const unsubError = engine.on('error', (err) => {
      setIsLoading(false);
      setLyrics(null);
      setError(err);
      setProvider('Not Found');
    });

    const unsubLine = engine.on('lineChange', ({ index, line }) => {
      setActiveIndex(index);
      setActiveLine(line);
    });

    const unsubOffset = engine.on('offsetChange', (newOffset) => {
      setOffsetMsState(newOffset);
    });

    setOffsetMsState(engine.offsetMs);

    return () => {
      unsubLoading();
      unsubLoaded();
      unsubError();
      unsubLine();
      unsubOffset();
    };
  }, [engine]);

  // Fetch when track changes
  useEffect(() => {
    if (track && track.title) {
      engine.fetchLyrics(track);
    } else {
      setLyrics(null);
      setActiveLine(null);
      setActiveIndex(-1);
    }
  }, [track?.title, track?.artist, engine]);

  // Update progress as audio plays
  useEffect(() => {
    engine.updateProgress(currentTimeMs);
  }, [currentTimeMs, engine]);

  const setOffset = useCallback((newOffset) => {
    engine.setOffset(newOffset);
  }, [engine]);

  return {
    lyrics,
    activeLine,
    activeIndex,
    isLoading,
    error,
    provider,
    offsetMs,
    setOffsetMs: setOffset
  };
}
