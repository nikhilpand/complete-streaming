"use client";

import React, {
  useEffect, useRef, useState, memo, useMemo, useCallback,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Loader2, X, Music2, RotateCcw,
  Volume2, VolumeX, Volume1, Heart, ListMusic, Sparkles,
} from 'lucide-react';
import { parseLRC, findActiveIndex, type ParsedLyricLine } from '@/lib/lyric-parser';
import { getProxiedImageUrl, fetchLyrics } from '@/lib/api';
import { isDevanagari, devanagariToRoman } from '@/lib/transliteration';
import Link from 'next/link';
import { useLyricsSettings, getLyricsCSSVars } from '@/store/useLyricsSettings';
import { LyricsSettingsPopover } from './LyricsSettingsPopover';
import { DesktopLyricsProgressBar } from './lyrics/DesktopLyricsProgressBar';
import { MobileLyricsControls } from './lyrics/MobileLyricsControls';
import { usePlaybackTelemetry, type RecommendationTrack } from '@/hooks/usePlaybackTelemetry';
import { Artwork } from '@/components/artwork/Artwork';
import { artistNames } from '@/lib/utils';
import type { LyricsTimingProvenance, LyricsSyncType } from '@/lib/lyrics-engine/types';


// ─── Format Time mm:ss ──────────────────────────────────────────────────
function formatTime(sec: number): string {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Lyric Line (memoised — never re-renders post-mount) ─────────────────
const LyricLine = memo(({
  line,
  index,
  showRomanized,
}: {
  line: ParsedLyricLine;
  index: number;
  showRomanized?: boolean;
}) => {
  if (line.isInstrumental || (!line.text?.trim() && (!line.words || line.words.length === 0))) {
    return (
      <div id={`line-${index}`} className="blyrics--line blyrics--instrumental" data-index={index} tabIndex={0}>
        <div className="blyrics--dots">
          {[0, 1, 2].map((d) => <div key={d} className="blyrics--dot" data-dot={d} />)}
        </div>
      </div>
    );
  }

  const shouldRomanize = Boolean(showRomanized && (line.romanized || isDevanagari(line.text)));
  const displayText = shouldRomanize
    ? (line.romanized || (isDevanagari(line.text) ? devanagariToRoman(line.text) : line.text))
    : line.text;

  const hasWords = Array.isArray(line.words) && line.words.length > 0;
  const wordsToRender = hasWords
    ? (shouldRomanize
        ? line.words.map((w) => ({
            ...w,
            text: isDevanagari(w.text) ? devanagariToRoman(w.text) : w.text,
          }))
        : line.words)
    : [];

  return (
    <div id={`line-${index}`} className="blyrics--line" data-index={index} tabIndex={0}>
      {hasWords ? (
        wordsToRender.map((word, wIdx) => (
          <span
            key={wIdx}
            className="blyrics--word"
            data-time={word.startTime}
            data-content={word.text}
          >
            {word.text}{' '}
          </span>
        ))
      ) : (
        <span className="blyrics--line-text">
          {displayText}
        </span>
      )}
    </div>
  );
});
LyricLine.displayName = 'LyricLine';

// ─── Main FullScreenLyrics Component ─────────────────────────────────────
export function FullScreenLyrics({ onClose }: { onClose?: () => void }) {
  const rawTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const skipNext = usePlayerStore((s) => s.playNext);
  const skipPrev = usePlayerStore((s) => s.playPrev);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const shuffle = usePlayerStore((s) => s.isShuffled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const repeat = repeatMode === 'none' ? 'off' : repeatMode;
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  const currentTrack = useMemo(() => {
    if (!rawTrack) return null;
    return {
      id: rawTrack.id,
      videoId: rawTrack.id,
      title: rawTrack.title || '',
      artist: artistNames(rawTrack.artists, rawTrack.subtitle),
      thumbnail: rawTrack.artwork_url || '',
      artwork_url: rawTrack.artwork_url || '',
      album: rawTrack.album || (rawTrack.subtitle?.split(/\s*[·•|]\s*/)[0]?.trim()) || '',
      subtitle: rawTrack.subtitle || '',
      lyricsId: rawTrack.lyrics_id,
      hasLyrics: rawTrack.has_lyrics,
      duration: rawTrack.duration_ms ? rawTrack.duration_ms / 1000 : 0,
    };
  }, [rawTrack]);

  const duration = usePlayerStore((s) => s.duration) || (currentTrack?.duration || 0);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);

  // Lyrics settings & telemetry hooks
  const lyricsSettings = useLyricsSettings();
  const telemetry = usePlaybackTelemetry();

  // Local UI states
  const [isLiked, setIsLiked] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendationTrack[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else if (toggleLyrics) {
      toggleLyrics();
    }
  }, [onClose, toggleLyrics]);


  // Load liked state from localStorage
  useEffect(() => {
    const trackId = currentTrack?.id || (currentTrack as any)?.videoId;
    if (!trackId) return;
    try {
      const stored = localStorage.getItem(`sway_liked_${trackId}`);
      setIsLiked(stored === 'true');
    } catch {
      setIsLiked(false);
    }
  }, [currentTrack?.id, (currentTrack as any)?.videoId]);

  const toggleLike = useCallback(() => {
    const trackId = currentTrack?.id || (currentTrack as any)?.videoId;
    if (!trackId) return;
    const next = !isLiked;
    setIsLiked(next);
    try {
      localStorage.setItem(`sway_liked_${trackId}`, next ? 'true' : 'false');
    } catch {}
    if (next) telemetry.logLike();
    else telemetry.logUnlike();
  }, [currentTrack?.id, (currentTrack as any)?.videoId, isLiked, telemetry]);

  // Fetch recommendations for Up Next drawer
  useEffect(() => {
    if (!isDrawerOpen) return;
    setRecsLoading(true);
    const trackId = currentTrack?.id || (currentTrack as any)?.videoId || '';
    const url = `/api/proxy/recommendations?current_track_id=${encodeURIComponent(trackId)}&n=12`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setRecommendations(data);
      })
      .catch(() => setRecommendations([]))
      .finally(() => setRecsLoading(false));
  }, [isDrawerOpen, currentTrack?.id, (currentTrack as any)?.videoId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        if (isDrawerOpen) {
          setIsDrawerOpen(false);
        } else {
          handleClose();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'm' || e.key === 'M') {
        setMuted(!isMuted);
      } else if (e.key === 'n' || e.key === 'N') {
        skipNext();
      } else if (e.key === 'p' || e.key === 'P') {
        skipPrev();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const cur = usePlayerStore.getState().currentTime;
        seekTo(Math.max(0, cur - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = usePlayerStore.getState().currentTime;
        seekTo(Math.min(duration, cur + 5));
      } else if (e.key === '[') {
        const trackKey = currentTrack?.id || (currentTrack as any)?.videoId;
        if (trackKey) {
          const curr = lyricsSettings.getTrackSyncOffset(trackKey);
          lyricsSettings.setTrackSyncOffset(trackKey, curr - 50);
        }
      } else if (e.key === ']') {
        const trackKey = currentTrack?.id || (currentTrack as any)?.videoId;
        if (trackKey) {
          const curr = lyricsSettings.getTrackSyncOffset(trackKey);
          lyricsSettings.setTrackSyncOffset(trackKey, curr + 50);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleClose, togglePlayPause, skipNext, skipPrev, seekTo,
    duration, isMuted, setMuted, isDrawerOpen, currentTrack?.id, (currentTrack as any)?.videoId, lyricsSettings,
  ]);

  // --- Lyrics state ---
  const [activeLyrics, setActiveLyrics] = useState<ParsedLyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState(false);
  const [lyricsProvider, setLyricsProvider] = useState<string>('');
  const [lyricsSyncQuality, setLyricsSyncQuality] = useState<string>('LINE');
  const [provenance, setProvenance] = useState<LyricsTimingProvenance | null>(null);
  const [hasHindiScript, setHasHindiScript] = useState<boolean>(false);

  // --- User Manual Scroll & Touch Handling ---
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const isUserScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Touch tracking refs
  const touchStartY = useRef(0);
  const touchLastY = useRef(0);
  const touchLastTime = useRef(0);
  const touchVelocity = useRef(0);
  const isDragging = useRef(false);
  // --- DOM refs for the 144fps engine ---
  const containerRef    = useRef<HTMLDivElement>(null);
  const wrapperRef      = useRef<HTMLDivElement>(null);
  const lastActiveIdx   = useRef(-1);
  const lastProcTime    = useRef(0);
  const elemCache       = useRef<Map<number, { elt: HTMLElement; words: HTMLElement[]; dots: HTMLElement[] }>>(new Map());
  const offsetCache     = useRef({ base: 0.0, rich: 0.0, scroll: 0.500 });
  const currentScrollY  = useRef(0);
  const targetScrollY   = useRef(0);
  const isInitialPositionSet = useRef(false);

  const rawCover = currentTrack?.artwork_url || currentTrack?.thumbnail;
  const coverUrl = rawCover ? getProxiedImageUrl(rawCover, 500, 500) : '';

  // Authentic timing contract: word sweeping is active ONLY for verified WORD/SYLLABLE sync
  const isRich = useMemo(() => {
    if (!provenance?.isAuthenticTiming) return false;
    if (provenance.syncType !== 'WORD' && provenance.syncType !== 'SYLLABLE') return false;
    return activeLyrics.some((l) => Array.isArray(l.words) && l.words.length > 0);
  }, [activeLyrics, provenance]);

  // ── Fetch lyrics via Ultra Lyrics Engine ──
  useEffect(() => {
    if (!currentTrack?.title) {
      setActiveLyrics([]);
      setLyricsError(false);
      setLyricsProvider('');
      setHasHindiScript(false);
      return;
    }
    let cancelled = false;
    setLyricsLoading(true);
    setLyricsError(false);
    setActiveLyrics([]);
    setLyricsProvider('');
    setLyricsSyncQuality('LINE');
    setHasHindiScript(false);
    lastActiveIdx.current = -1;
    lastProcTime.current = 0;
    currentScrollY.current = 0;
    targetScrollY.current = 0;
    isInitialPositionSet.current = false;
    isUserScrollingRef.current = false;
    setIsUserScrolling(false);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
      userScrollTimeoutRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.style.setProperty('transform', 'translate3d(0, 0px, 0)', 'important');
    }

    const trackArtist = currentTrack.artist || currentTrack.subtitle || '';
    const trackDuration = currentTrack.duration || duration || 0;
    const streamUrl = typeof window !== 'undefined' ? (audioManager as any)?.currentSrc : undefined;

    fetchLyrics(
      currentTrack.id,
      currentTrack.title,
      trackArtist,
      currentTrack.album,
      currentTrack.subtitle,
      trackDuration,
      currentTrack.lyricsId,
      streamUrl
    )
      .then((data) => {
        if (cancelled) return;
        if (data.provider) setLyricsProvider(data.provider);
        if (data.syncQuality) setLyricsSyncQuality(data.syncQuality);
        if (data.provenance) setProvenance(data.provenance);

        const isAuthenticWordSync = data.provenance
          ? (data.provenance.isAuthenticTiming && (data.provenance.syncType === 'WORD' || data.provenance.syncType === 'SYLLABLE'))
          : (data.syncQuality === 'WORD');

        if (data.synced && data.lines && data.lines.length > 0) {
          const parsedLines: ParsedLyricLine[] = data.lines.map((l: any) => {
            const rawTime = (l.startMs !== undefined && l.startMs !== null) ? l.startMs / 1000 : (l.time ?? 0);
            const rawEndTime = (l.endMs !== undefined && l.endMs !== null) ? l.endMs / 1000 : (l.endTime ?? (rawTime + 3));
            const rawText = l.original || l.text || '';
            const rawWords = (isAuthenticWordSync && Array.isArray(l.words) && l.words.length > 0)
              ? l.words.map((w: any) => ({
                  text: w.text,
                  startTime: (w.startMs !== undefined && w.startMs !== null) ? w.startMs / 1000 : (w.startTime ?? 0),
                  endTime: (w.endMs !== undefined && w.endMs !== null) ? w.endMs / 1000 : (w.endTime ?? 0),
                  romanized: w.romanized,
                }))
              : [];

            return {
              time: rawTime,
              endTime: rawEndTime,
              text: rawText,
              romanized: l.romanized || (isDevanagari(rawText) ? devanagariToRoman(rawText) : undefined),
              words: rawWords,
              isInstrumental: Boolean(l.isInstrumental),
            };
          });
          setActiveLyrics(parsedLines);
          if (data.isDevanagari || parsedLines.some(l => isDevanagari(l.text))) {
            setHasHindiScript(true);
          }
        } else if (data.synced && data.lrc) {
          const parsed = parseLRC(data.lrc);
          const enriched = parsed.map((l) => ({
            ...l,
            words: [], // Pure line sync: no fake words
            romanized: isDevanagari(l.text) ? devanagariToRoman(l.text) : undefined,
          }));
          setActiveLyrics(enriched.length > 0 ? enriched : []);
          if (enriched.some(l => isDevanagari(l.text))) {
            setHasHindiScript(true);
          }
          if (enriched.length === 0 && !data.plain) setLyricsError(true);
        } else if (data.plain || (data.lines && data.lines.length > 0)) {
          setLyricsSyncQuality('NONE');
          setProvenance({
            syncType: 'NONE',
            timingProvenance: 'PLAIN',
            timingSource: 'unknown',
            isAuthenticTiming: false,
            matchConfidence: 0,
            timingConfidence: 0,
            acousticConfidence: 0,
            overallConfidence: 0,
            confidence: 0,
          });
          const plainLines: string[] = data.plain
            ? data.plain.split('\n').map((l: string) => l.trim()).filter(Boolean)
            : (data.lines || []).map((l: any) => (l.original || l.text || '').trim()).filter(Boolean);

          const unSyncedLines: ParsedLyricLine[] = plainLines.map((text: string) => ({
            time: -1,
            endTime: -1,
            text,
            romanized: isDevanagari(text) ? devanagariToRoman(text) : undefined,
            words: [],
            isInstrumental: false,
          }));
          setActiveLyrics(unSyncedLines);
          if (unSyncedLines.some(l => isDevanagari(l.text))) {
            setHasHindiScript(true);
          }
        } else {
          setLyricsError(true);
        }
      })
      .catch(() => { if (!cancelled) setLyricsError(true); })
      .finally(() => { if (!cancelled) setLyricsLoading(false); });

    return () => { cancelled = true; };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.duration]);

  // ── Cache DOM element references once lyrics render ──
  useEffect(() => {
    if (!containerRef.current || !activeLyrics.length) return;
    const container = containerRef.current;

    const buildCache = () => {
      const lines = container.querySelectorAll<HTMLElement>('.blyrics--line');
      elemCache.current.clear();
      lines.forEach((el, idx) => {
        elemCache.current.set(idx, {
          elt: el,
          words: Array.from(el.querySelectorAll<HTMLElement>('.blyrics--word')),
          dots: Array.from(el.querySelectorAll<HTMLElement>('.blyrics--dot')),
        });
      });
      lastActiveIdx.current = -1;
    };

    const raf = requestAnimationFrame(buildCache);
    const ro = new ResizeObserver(buildCache);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [activeLyrics]);

  // ── User Manual Scroll & Touch Detection ──
  const resumeAutoScroll = useCallback(() => {
    isUserScrollingRef.current = false;
    setIsUserScrolling(false);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
      userScrollTimeoutRef.current = null;
    }
    if (lastActiveIdx.current >= 0 && containerRef.current && wrapperRef.current) {
      const activeEl = elemCache.current.get(lastActiveIdx.current)?.elt ||
        containerRef.current.querySelector<HTMLElement>(`#line-${lastActiveIdx.current}`);
      if (activeEl && activeEl.offsetHeight > 0) {
        const wrapperHeight = wrapperRef.current.clientHeight;
        const opticalCenter = wrapperHeight * 0.38;
        targetScrollY.current = Math.max(0, activeEl.offsetTop - opticalCenter);
      }
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    isUserScrollingRef.current = true;
    setIsUserScrolling(true);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      resumeAutoScroll();
    }, 4500);

    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;
    const wrapperHeight = wrapper.clientHeight;
    const maxScroll = Math.max(0, container.scrollHeight - wrapperHeight * 0.4);
    const minScroll = 0;
    targetScrollY.current = Math.max(minScroll, Math.min(maxScroll, targetScrollY.current + e.deltaY));
  }, [resumeAutoScroll]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!e.touches.length) return;
    const y = e.touches[0].clientY;
    touchStartY.current = y;
    touchLastY.current = y;
    touchLastTime.current = performance.now();
    touchVelocity.current = 0;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || !e.touches.length) return;
    const y = e.touches[0].clientY;
    const totalDist = Math.abs(y - touchStartY.current);

    // Only engage manual scroll mode if finger moved past 8px slop threshold
    if (totalDist > 8) {
      if (!isUserScrollingRef.current) {
        isUserScrollingRef.current = true;
        setIsUserScrolling(true);
      }
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = null;
      }
    }

    const deltaY = touchLastY.current - y;
    const now = performance.now();
    const dt = Math.max(1, now - touchLastTime.current);
    touchVelocity.current = deltaY / dt;
    touchLastY.current = y;
    touchLastTime.current = now;

    if (!isUserScrollingRef.current) return;

    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;

    const wrapperHeight = wrapper.clientHeight;
    const maxScroll = Math.max(0, container.scrollHeight - wrapperHeight * 0.4);
    const minScroll = 0;

    targetScrollY.current = Math.max(minScroll, Math.min(maxScroll, targetScrollY.current + deltaY));
    currentScrollY.current = targetScrollY.current;
    container.style.setProperty('transform', `translate3d(0, ${-currentScrollY.current.toFixed(2)}px, 0)`, 'important');
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    // If the touch was just a tap and never moved past slop, do NOT engage manual scroll timer
    if (!isUserScrollingRef.current) {
      return;
    }

    // Apply smooth momentum fling on quick swipe
    const vel = touchVelocity.current;
    if (Math.abs(vel) > 0.12) {
      const container = containerRef.current;
      const wrapper = wrapperRef.current;
      if (container && wrapper) {
        const wrapperHeight = wrapper.clientHeight;
        const maxScroll = Math.max(0, container.scrollHeight - wrapperHeight * 0.4);
        const minScroll = 0;
        targetScrollY.current = Math.max(minScroll, Math.min(maxScroll, targetScrollY.current + vel * 260));
      }
    }

    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      resumeAutoScroll();
    }, 4500);
  }, [resumeAutoScroll]);

  // ── Click-to-seek ──
  const handleLineClick = useCallback((e: React.MouseEvent) => {
    // If user dragged more than 8px, it was a touch scroll/swipe, not a tap
    if (Math.abs(touchStartY.current - touchLastY.current) > 8) return;

    const target = (e.target as HTMLElement).closest<HTMLElement>('.blyrics--line');
    if (!target) return;
    const idx = parseInt(target.dataset.index || '-1', 10);
    if (idx >= 0 && idx < activeLyrics.length && activeLyrics[idx].time >= 0) {
      seekTo(activeLyrics[idx].time);
      isUserScrollingRef.current = false;
      setIsUserScrolling(false);
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = null;
      }
      lastActiveIdx.current = idx;
      if (containerRef.current && wrapperRef.current) {
        const wrapperHeight = wrapperRef.current.clientHeight;
        const opticalCenter = wrapperHeight * 0.38;
        targetScrollY.current = Math.max(0, target.offsetTop - opticalCenter);
      }
    }
  }, [activeLyrics, seekTo]);

  // ── 144fps Sync & Scroll Engine ──
  useEffect(() => {
    if (!activeLyrics.length || !containerRef.current) return;
    const container = containerRef.current;
    let running = true;
    let rafId: number;
    let lastTick = 0;       // for throttled lyrics-sync work (7ms gate)
    let lastScrollT = -1;   // -1 = sentinel: skip lerp on very first frame

    const isPlain = lyricsSyncQuality === 'NONE' || provenance?.syncType === 'NONE';

    const tick = (now: number) => {
      if (!running) return;

      // ── Scroll lerp — runs EVERY rAF frame, frame-rate-independent ──────
      if (lastScrollT < 0) {
        lastScrollT = now; // first frame: just record time, don't lerp
      } else {
        const dt = Math.min(now - lastScrollT, 100); // clamp: ignore tab-switch gaps
        lastScrollT = now;

        // Only lerp when not actively dragging finger
        if (!isDragging.current) {
          const diff = targetScrollY.current - currentScrollY.current;
          if (Math.abs(diff) > 0.05) {
            const decay = isUserScrollingRef.current ? 0.76 : 0.84;
            const factor = 1 - Math.pow(decay, dt / 16.667);
            currentScrollY.current += diff * factor;
            container.style.setProperty('transform', `translate3d(0, ${-currentScrollY.current.toFixed(3)}px, 0)`, 'important');
          }
        }
      }

      // If lyrics are plain / unsynced, do NOT run lyrics sync, active line highlighting, or auto-scrolling
      if (isPlain) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      // ── Lyrics sync — throttled to ~7ms (avoid over-computing) ─────────
      if (now - lastTick >= 7) {
        lastTick = now;

        const rawTime = (audioManager && !isNaN(audioManager.currentTime) && audioManager.currentTime >= 0)
          ? audioManager.currentTime
          : usePlayerStore.getState().currentTime || 0;

        const { base, rich } = offsetCache.current;
        const trackKey = currentTrack?.id || (currentTrack as any)?.videoId;
        const customOffsetMs = trackKey
          ? lyricsSettings.getTrackSyncOffset(trackKey)
          : 0;
        const userOffsetSec = customOffsetMs / 1000;

        const offset = (isRich ? rich : base) + userOffsetSec;
        const highlightTime = rawTime + offset;
        const currentTime_  = rawTime + offset;
        const isSeek = Math.abs(currentTime_ - lastProcTime.current) > 0.8;
        lastProcTime.current = currentTime_;

        const idx = findActiveIndex(highlightTime, activeLyrics);

        // Update active line class state
        if (idx !== lastActiveIdx.current || isSeek) {
          const prevIdx = lastActiveIdx.current;

          const updateLine = (i: number) => {
            const cached = elemCache.current.get(i);
            const el = cached?.elt || container.querySelector<HTMLElement>(`#line-${i}`);
            if (!el) return;
            const isActive   = i === idx;
            const isPassed   = i < idx;
            const isNeighbor = i === idx - 1 || i === idx + 1;

            el.classList.toggle('blyrics--active', isActive);
            el.classList.toggle('blyrics--passed', isPassed);
            el.classList.toggle('blyrics--neighbor', isNeighbor);
          };

          if (isSeek || lastActiveIdx.current === -1) {
            for (let i = 0; i < activeLyrics.length; i++) updateLine(i);
          } else {
            [prevIdx - 2, prevIdx - 1, prevIdx, prevIdx + 1, prevIdx + 2,
              idx - 2, idx - 1, idx, idx + 1, idx + 2]
              .filter(i => i >= 0 && i < activeLyrics.length)
              .forEach(updateLine);
          }

          // Reset words on line change
          if (prevIdx !== -1 && prevIdx !== idx) {
            const prevCached = elemCache.current.get(prevIdx);
            const prevWords = prevCached?.words || Array.from(container.querySelectorAll<HTMLElement>(`#line-${prevIdx} .blyrics--word`));
            prevWords.forEach((w) => {
              if (prevIdx < idx) {
                w.style.setProperty('--word-progress', '100%');
                w.classList.add('blyrics--word-done');
              } else {
                w.style.setProperty('--word-progress', '0%');
                w.classList.remove('blyrics--word-done');
              }
            });
          }

          lastActiveIdx.current = idx;
        }

        // Update scroll target (only when user is not manually scrolling)
        if (!isUserScrollingRef.current && idx !== -1) {
          const cached = elemCache.current.get(idx);
          const activeEl = cached?.elt || container.querySelector<HTMLElement>(`#line-${idx}`);
          if (activeEl && activeEl.offsetHeight > 0) {
            const wrapperHeight = wrapperRef.current?.clientHeight || window.innerHeight;
            const opticalCenter = wrapperHeight * 0.38;
            const targetY = Math.max(0, activeEl.offsetTop - opticalCenter);
            targetScrollY.current = targetY;

            if (!isInitialPositionSet.current) {
              currentScrollY.current = targetY;
              container.style.setProperty('transform', `translate3d(0, ${-currentScrollY.current.toFixed(2)}px, 0)`, 'important');
              isInitialPositionSet.current = true;
            }
          }
        }

        // Word karaoke sweep
        if (idx >= 0 && idx < activeLyrics.length) {
          const lineData = activeLyrics[idx];
          const cached = elemCache.current.get(idx);
          const words = cached?.words || Array.from(container.querySelectorAll<HTMLElement>(`#line-${idx} .blyrics--word`));

          if (words.length && lineData?.words?.length) {
            words.forEach((wordElt, wIdx) => {
              const wd = lineData.words[wIdx];
              if (!wd) return;

              if (highlightTime >= wd.endTime) {
                if (wordElt.style.getPropertyValue('--word-progress') !== '100%') {
                  wordElt.style.setProperty('--word-progress', '100%');
                  wordElt.classList.add('blyrics--word-done');
                }
              } else if (highlightTime >= wd.startTime) {
                const dur = Math.max(0.08, wd.endTime - wd.startTime);
                const prog = Math.min(100, Math.max(0, ((highlightTime - wd.startTime) / dur) * 100));
                wordElt.style.setProperty('--word-progress', `${prog.toFixed(2)}%`);
                wordElt.classList.remove('blyrics--word-done');
              } else {
                wordElt.style.setProperty('--word-progress', '0%');
                wordElt.classList.remove('blyrics--word-done');
              }
            });
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [activeLyrics, isRich, lyricsSyncQuality, provenance, currentTrack?.id, (currentTrack as any)?.videoId]);


  if (!currentTrack) return null;

  // Extract separate artist names
  const artistList = currentTrack.artist
    ? currentTrack.artist.split(/,\s*|\s*&\s*/).filter(Boolean)
    : ['Unknown Artist'];

  // Dynamic palette from CSS custom properties (updated on root via colorExtractor)
  const bgMain     = 'var(--art-bg-main, #0a0d13)';
  const pillBg     = 'var(--art-pill-bg, rgba(25, 30, 42, 0.65))';
  const pillActive = 'var(--art-pill-active, rgba(255,255,255,0.22))';

  // Generate CSS styles from lyrics settings
  const customCSSVars = getLyricsCSSVars(lyricsSettings);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.982 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.982 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`better-lyrics-page ${lyricsSettings.showAccentBar ? 'blyrics-accent-bar' : ''} ${lyricsSettings.align === 'center' ? 'blyrics-align-center' : ''}`}
      style={{
        background: bgMain,
        '--blyrics-background-img': coverUrl ? `url(${coverUrl})` : 'none',
        ...customCSSVars,
      } as React.CSSProperties}
    >
      {/* Ambient aurora layer — CSS-driven, no JS */}
      <div className="blyrics-aurora" aria-hidden="true" />

      {/* ── Desktop Top Header Actions ── */}
      <div className="hidden lg:flex absolute top-5 right-5 z-[2000] items-center gap-2.5">
        <LyricsSettingsPopover currentTrackId={currentTrack.id || (currentTrack as any).videoId} />

        <button
          type="button"
          onClick={() => setIsDrawerOpen((prev) => !prev)}
          aria-label="Up next queue"
          className={`blyrics-action-btn ${isDrawerOpen ? 'active' : ''}`}
          title="Up Next & Recommendations"
        >
          <ListMusic size={18} />
        </button>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close lyrics"
          className="blyrics-action-btn"
          title="Close (Esc)"
        >
          <X size={19} />
        </button>
      </div>

      {/* Side Panel: Album Art, Metadata & Controls */}
      <div className="blyrics-side-panel">
        {/* Mobile Back Button */}
        <button
          onClick={handleClose}
          aria-label="Back to player"
          className="lg:hidden w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-white/10 cursor-pointer active:scale-95"
        >
          <ChevronDown size={20} color="white" />
        </button>

        {/* Album Artwork */}
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="album-art shrink-0 overflow-hidden relative group"
        >
          <Artwork
            src={coverUrl}
            alt={currentTrack.title}
            size={500}
            className="w-full h-full object-cover select-none"
          />
        </motion.div>

        {/* Track Title & Artist */}
        <div className="track-info min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h1 className="title select-text flex-1 truncate" title={currentTrack.title}>
              {currentTrack.title}
            </h1>
            {/* Heart / Like Button */}
            <button
              type="button"
              onClick={toggleLike}
              aria-label={isLiked ? 'Unlike track' : 'Like track'}
              className="p-1 transition-transform hover:scale-115 active:scale-90 cursor-pointer shrink-0"
              title={isLiked ? 'Liked' : 'Save to favorites'}
            >
              <Heart
                size={18}
                className={isLiked ? 'fill-rose-500 text-rose-500' : 'text-white/50 hover:text-white'}
              />
            </button>
          </div>

          {/* Clickable Artists */}
          <div className="artist flex flex-wrap items-center gap-1 text-white/70">
            {artistList.map((art, idx) => (
              <React.Fragment key={art}>
                <Link
                  href={`/search?q=${encodeURIComponent(art.trim())}`}
                  className="hover:text-white hover:underline transition-colors"
                  title={`Search ${art.trim()}`}
                >
                  {art.trim()}
                </Link>
                {idx < artistList.length - 1 && <span className="text-white/40">,</span>}
              </React.Fragment>
            ))}
          </div>

          {/* Provider Badge & Script Toggle */}
          {(lyricsProvider || hasHindiScript) && (
            <div className="flex items-center gap-2 mt-2">
              {lyricsProvider && (
                <span className="text-[10px] font-mono tracking-wider px-2.5 py-0.5 rounded-full bg-white/10 text-white/80 border border-white/10 backdrop-blur-md">
                  Source: {lyricsProvider.toUpperCase()} · Sync: {lyricsSyncQuality === 'WORD' ? 'Word' : lyricsSyncQuality === 'LINE' ? 'Line' : 'Plain'}
                </span>
              )}
              {hasHindiScript && (
                <button
                  type="button"
                  onClick={() => lyricsSettings.setShowRomanized(!lyricsSettings.showRomanized)}
                  className="text-[10px] font-medium tracking-wide px-2.5 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-white/90 border border-white/20 transition-all cursor-pointer flex items-center gap-1.5"
                  title="Toggle Devanagari Hindi / Romanized English lyrics"
                >
                  <Sparkles size={11} className="text-amber-300" />
                  <span>{lyricsSettings.showRomanized ? 'English / Hinglish' : 'हिंदी (Hindi)'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile Top Actions (inline inside top header) */}
        <div className="lg:hidden flex items-center gap-1 shrink-0">
          <LyricsSettingsPopover currentTrackId={currentTrack.id || (currentTrack as any).videoId} />
          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-label="Up next queue"
            className={`blyrics-action-btn ${isDrawerOpen ? 'active' : ''}`}
            title="Up Next"
          >
            <ListMusic size={16} />
          </button>
        </div>

        {/* ── Desktop Progress Seek Bar (isolated re-renders) ── */}
        <DesktopLyricsProgressBar duration={duration} seekTo={seekTo} />

        {/* ── Desktop Controls Pill ── */}
        <div
          className="hidden lg:flex blyrics-controls-pill w-full"
          style={{ background: pillBg, maxWidth: '340px' }}
        >
          <button type="button" onClick={toggleShuffle} aria-label="Shuffle" title={shuffle ? 'Shuffle On' : 'Shuffle Off'}>
            <Shuffle size={17} color={shuffle ? 'white' : 'rgba(255,255,255,0.38)'} strokeWidth={shuffle ? 2.5 : 1.8} />
          </button>

          <button type="button" onClick={skipPrev} aria-label="Previous" title="Previous (P)">
            <SkipBack size={20} color="white" />
          </button>

          <button
            type="button"
            onClick={togglePlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="blyrics-play-btn"
            style={{ background: pillActive }}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isLoading ? (
              <Loader2 size={20} className="animate-spin text-white" />
            ) : isPlaying ? (
              <Pause size={20} color="white" />
            ) : (
              <Play size={20} fill="white" color="white" className="ml-0.5" />
            )}
          </button>

          <button type="button" onClick={skipNext} aria-label="Next" title="Next (N)">
            <SkipForward size={20} color="white" />
          </button>

          <button type="button" onClick={cycleRepeat} aria-label="Repeat mode" title={`Repeat: ${repeat}`}>
            {repeat === 'one' ? (
              <Repeat1 size={17} color="white" strokeWidth={2.5} />
            ) : (
              <Repeat size={17} color={repeat === 'off' ? 'rgba(255,255,255,0.38)' : 'white'} strokeWidth={repeat === 'off' ? 1.8 : 2.5} />
            )}
          </button>
        </div>

        {/* Desktop Volume & Mute Control */}
        <div className="hidden lg:flex items-center gap-2.5 w-full max-w-[340px] px-2 text-white/60">
          <button
            type="button"
            onClick={() => {
              setMuted(!isMuted);
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            className="hover:text-white transition-colors cursor-pointer"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX size={16} />
            ) : volume < 0.5 ? (
              <Volume1 size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
            }}
            className="w-full h-1 bg-white/15 rounded-lg accent-white cursor-pointer"
            aria-label="Volume level"
          />
        </div>
      </div>

      {/* Lyrics Display Panel (Supports Wheel + Touch Drag Scrolling) */}
      <div
        className="blyrics-panel"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheel}
        onClick={handleLineClick}
      >
        <div ref={wrapperRef} id="blyrics-wrapper">
          <div
            id="blyrics-container"
            ref={containerRef}
            className={lyricsSyncQuality === 'NONE' ? 'blyrics-unsynced' : ''}
            style={customCSSVars}
          >
            {activeLyrics.length > 0 ? (
              activeLyrics.map((line, lIdx) => (
                <LyricLine
                  key={lIdx}
                  line={line}
                  index={lIdx}
                  showRomanized={lyricsSettings.showRomanized}
                />
              ))
            ) : (
              <div className="blyrics--line blyrics--active flex items-center gap-3 py-10 opacity-70">
                {lyricsLoading ? (
                  <>
                    <Loader2 size={22} className="animate-spin text-white" />
                    <span className="text-white text-xl font-bold">Synchronizing lyrics…</span>
                  </>
                ) : lyricsError ? (
                  <span className="text-white text-xl font-bold">No synchronized lyrics available.</span>
                ) : (
                  <span className="text-white text-xl font-bold">Play a track to view synchronized lyrics</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Floating "Sync to Now" Resume Pill */}
        <AnimatePresence>
          {lyricsSyncQuality !== 'NONE' && isUserScrolling && activeLyrics.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="absolute bottom-8 right-8 z-[200]"
            >
              <button
                type="button"
                onClick={resumeAutoScroll}
                className="blyrics-sync-pill"
              >
                <RotateCcw size={14} />
                <span>Sync to Now</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile Bottom Controls & Mini Seek (Placed OUTSIDE masked panel) ── */}
      <MobileLyricsControls
        duration={duration}
        seekTo={seekTo}
        pillBg={pillBg}
        pillActive={pillActive}
      />


      {/* ── Up Next Slide-out Drawer ── */}
      <AnimatePresence>
        {isDrawerOpen && (
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="blyrics-drawer"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ListMusic size={18} className="text-white/80" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">Up Next & Taste</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Playing Now */}
              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                  Now Playing
                </span>
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/10 border border-white/15">
                  <Artwork
                    src={coverUrl}
                    alt={currentTrack.title}
                    size={40}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">{currentTrack.title}</p>
                    <p className="text-[11px] text-white/60 truncate">{currentTrack.artist}</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
              </div>

              {/* Queue Items if any */}
              {queue.length > queueIndex + 1 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                    In Queue ({queue.length - queueIndex - 1})
                  </span>
                  <div className="space-y-1.5">
                    {queue.slice(queueIndex + 1, queueIndex + 4).map((qTrack, qIdx) => (
                      <div
                        key={qTrack.id || qIdx}
                        onClick={() => setCurrentTrack(qTrack)}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-medium text-white truncate">{qTrack.title}</p>
                          <p className="text-[10px] text-white/50 truncate">
                            {qTrack.artists?.map((a) => a.name).join(', ') || qTrack.subtitle}
                          </p>
                        </div>
                        <span className="text-[10px] text-white/40 font-mono">Next</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Taste Engine Recommendations */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-amber-400" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                      Discovery & Radio
                    </span>
                  </div>
                  <span className="text-[10px] text-white/40">SWAY Taste V1</span>
                </div>

                {recsLoading ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-white/50 text-xs">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Curating taste recommendations…</span>
                  </div>
                ) : recommendations.length > 0 ? (
                  <div className="space-y-2">
                    {recommendations.map((rec) => (
                      <div
                        key={rec.id}
                        onClick={() => {
                          // Play recommendation track
                          setCurrentTrack({
                            id: rec.id,
                            title: rec.title,
                            artists: [{ id: rec.id, name: rec.artist }],
                            subtitle: rec.artist,
                            album: rec.album || 'Single',
                            artwork_url: '',
                            duration_ms: 180000,
                            has_lyrics: true,
                          } as any);
                          setIsDrawerOpen(false);
                        }}
                        className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/5 hover:border-white/15 transition-all cursor-pointer space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white truncate">{rec.title}</p>
                          {rec.badge && (
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/10 font-medium text-white/80 shrink-0">
                              {rec.badge}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-white/50">
                          <span className="truncate">{rec.artist}</span>
                          <span className="text-[10px] text-white/40 italic truncate max-w-[140px]">
                            {rec.explanation}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-white/40 py-4 text-center">No recommendations loaded.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
