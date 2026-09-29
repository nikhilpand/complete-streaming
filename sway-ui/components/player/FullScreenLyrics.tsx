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
  MessageSquareQuote, MoreHorizontal, Maximize2, Minimize2,
  Disc3, Mic2, Sliders, Share2, Check, Download,
} from 'lucide-react';
import { findActiveIndex, type ParsedLyricLine } from '@/lib/lyric-parser';
import { getProxiedImageUrl } from '@/lib/api';
import { getCachedLyrics, fetchLyricsWithCache } from '@/lib/lyricsCache';
import { isNonLatinScript, romanizeMixedText } from '@/lib/transliteration';
import Link from 'next/link';
import {
  useLyricsSettings,
  getLyricsCSSVars,
} from '@/store/useLyricsSettings';
import { DesktopLyricsProgressBar } from './lyrics/DesktopLyricsProgressBar';
import { MobileLyricsControls } from './lyrics/MobileLyricsControls';
import { LyricShareCardModal } from './lyrics/LyricShareCardModal';
import type { RecommendationTrack } from '@/lib/api/types';
import { Artwork } from '@/components/artwork/Artwork';
import { artistNames } from '@/lib/utils';
import { useLikedSongs } from '@/store/useLikedSongs';
import { downloadSong, type DownloadStatus } from '@/lib/download';
import type { LyricsTimingProvenance } from '@/lib/lyrics-engine/types';

// ─── Lyric Line (memoised — never re-renders post-mount) ─────────────────
const LyricLine = memo(({
  line,
  index,
  showRomanized,
  showInstrumentalCountdown,
}: {
  line: ParsedLyricLine;
  index: number;
  showRomanized?: boolean;
  showInstrumentalCountdown?: boolean;
}) => {
  if (line.isInstrumental || (!line.text?.trim() && (!line.words || line.words.length === 0))) {
    const durationSec = Math.max(2, Math.round((line.endTime || (line.time + 3)) - line.time));
    return (
      <div id={`line-${index}`} className="blyrics--line blyrics--instrumental" data-index={index} tabIndex={0}>
        <div className="blyrics--dots">
          {[0, 1, 2].map((d) => <div key={d} className="blyrics--dot" data-dot={d} />)}
        </div>
        {showInstrumentalCountdown && (
          <span className="blyrics--instrumental-label ml-3 text-[11px] font-mono tracking-wider text-white/70">
            Solo / Instrumental · {durationSec}s
          </span>
        )}
      </div>
    );
  }

  const hasNonLatin = isNonLatinScript(line.text);
  const shouldRomanize = Boolean(showRomanized && (line.romanized || hasNonLatin));
  const displayText = shouldRomanize
    ? (line.romanized || romanizeMixedText(line.text))
    : line.text;

  const hasWords = Array.isArray(line.words) && line.words.length > 0;
  const wordsToRender = hasWords
    ? (shouldRomanize
        ? line.words.map((w) => ({
            ...w,
            text: w.romanized || (isNonLatinScript(w.text) ? romanizeMixedText(w.text) : w.text),
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
      {shouldRomanize && line.text && line.text !== displayText && (
        <span
          className="blyrics--script-subtext block text-xs font-normal opacity-40 hover:opacity-75 transition-opacity tracking-wide mt-1 select-none font-sans"
          dir="auto"
        >
          {line.text}
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

  // Lyrics settings
  const lyricsSettings = useLyricsSettings();

  // Liked songs store
  const isLiked = useLikedSongs((s) => s.isLiked(rawTrack?.id));
  const toggleTrackLike = useLikedSongs((s) => s.toggleLike);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTickerLine, setCurrentTickerLine] = useState('');
  const [recommendations, setRecommendations] = useState<RecommendationTrack[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');

  const handleCopySongLink = useCallback(() => {
    if (!rawTrack) return;
    const url = `${window.location.origin}/song/${encodeURIComponent(rawTrack.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    });
  }, [rawTrack]);

  const handleDownload = useCallback(async () => {
    if (!rawTrack) return;
    try {
      await downloadSong(rawTrack, (s) => setDownloadStatus(s));
    } catch {
      // Handled in downloadSong
    }
  }, [rawTrack]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else if (toggleLyrics) {
      toggleLyrics();
    }
  }, [onClose, toggleLyrics]);


  const toggleLike = useCallback(() => {
    if (rawTrack) {
      toggleTrackLike(rawTrack);
    }
  }, [rawTrack, toggleTrackLike]);

  // Fetch recommendations for Up Next drawer
  const currentTrackId = currentTrack?.id || (currentTrack as any)?.videoId || '';
  useEffect(() => {
    if (!isDrawerOpen) return;
    setRecsLoading(true);
    const url = `/api/proxy/recommendations?current_track_id=${encodeURIComponent(currentTrackId)}&n=12`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setRecommendations(data);
      })
      .catch(() => setRecommendations([]))
      .finally(() => setRecsLoading(false));
  }, [isDrawerOpen, currentTrackId]);

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
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullScreen();
      } else if (e.key === 'v' || e.key === 'V') {
        lyricsSettings.cycleStageMode();
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
    handleClose, togglePlayPause, toggleFullScreen, skipNext, skipPrev, seekTo,
    duration, isMuted, setMuted, isDrawerOpen, currentTrackId, currentTrack, lyricsSettings,
  ]);

  // --- Lyrics state — lazily initialized from client cache for instant reopening ---
  const [activeLyrics, setActiveLyrics] = useState<ParsedLyricLine[]>(() => {
    if (!rawTrack) return [];
    const cached = getCachedLyrics(rawTrack.id, rawTrack.title, artistNames(rawTrack.artists, rawTrack.subtitle));
    return cached?.lines ?? [];
  });
  const [lyricsLoading, setLyricsLoading] = useState<boolean>(() => {
    if (!rawTrack?.title) return false;
    const cached = getCachedLyrics(rawTrack.id, rawTrack.title, artistNames(rawTrack.artists, rawTrack.subtitle));
    return !cached; // only show spinner if truly uncached
  });
  const [lyricsError, setLyricsError] = useState<boolean>(() => {
    if (!rawTrack) return false;
    const cached = getCachedLyrics(rawTrack.id, rawTrack.title, artistNames(rawTrack.artists, rawTrack.subtitle));
    return cached?.status === 'NOT_FOUND';
  });
  const [lyricsSyncQuality, setLyricsSyncQuality] = useState<string>(() => {
    if (!rawTrack) return 'LINE';
    const cached = getCachedLyrics(rawTrack.id, rawTrack.title, artistNames(rawTrack.artists, rawTrack.subtitle));
    return cached?.syncQuality ?? 'LINE';
  });
  const [provenance, setProvenance] = useState<LyricsTimingProvenance | null>(() => {
    if (!rawTrack) return null;
    const cached = getCachedLyrics(rawTrack.id, rawTrack.title, artistNames(rawTrack.artists, rawTrack.subtitle));
    return cached?.provenance ?? null;
  });

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

  // ── Fetch lyrics via Ultra Lyrics Engine (cache-first) ──
  useEffect(() => {
    if (!currentTrack?.title) {
      setActiveLyrics([]);
      setLyricsError(false);
      return;
    }

    // ── Fast path: cache is warm — apply immediately, skip all resets & network ──
    const cached = getCachedLyrics(currentTrack.id, currentTrack.title, currentTrack.artist);
    if (cached) {
      setActiveLyrics(cached.lines);
      setLyricsLoading(false);
      setLyricsError(cached.status === 'NOT_FOUND');
      setLyricsSyncQuality(cached.syncQuality);
      setProvenance(cached.provenance);
      return; // ← no network call, no spinner, instant
    }

    // ── Slow path: cache miss — show spinner and fetch ──
    let cancelled = false;
    setLyricsLoading(true);
    setLyricsError(false);
    setActiveLyrics([]);
    setLyricsSyncQuality('LINE');
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
    const trackDuration = currentTrack.duration > 0 ? currentTrack.duration : (duration > 0 ? duration : 0);

    fetchLyricsWithCache({
      songId: currentTrack.id,
      title: currentTrack.title,
      artist: trackArtist,
      album: currentTrack.album,
      subtitle: currentTrack.subtitle,
      duration: trackDuration,
      lyricsId: currentTrack.lyricsId,
    })
      .then((entry) => {
        if (cancelled) return;
        setLyricsSyncQuality(entry.syncQuality);
        setProvenance(entry.provenance);

        if (entry.status === 'NOT_FOUND' || entry.lines.length === 0) {
          setLyricsError(true);
          setActiveLyrics([]);
        } else {
          setActiveLyrics(entry.lines);
          setLyricsError(false);
        }
      })
      .catch(() => { if (!cancelled) setLyricsError(true); })
      .finally(() => { if (!cancelled) setLyricsLoading(false); });

    return () => { cancelled = true; };
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.subtitle,
    currentTrack?.lyricsId,
    currentTrack?.duration,
    duration,
  ]);

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
          const currentLine = (idx >= 0 && idx < activeLyrics.length) ? (activeLyrics[idx]?.text || '') : '';
          setCurrentTickerLine(currentLine);
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

          // Progressive instrumental dots activation
          if (lineData?.isInstrumental) {
            const cached = elemCache.current.get(idx);
            const dots = cached?.dots || Array.from(container.querySelectorAll<HTMLElement>(`#line-${idx} .blyrics--dot`));
            const start = lineData.time;
            const end = lineData.endTime || (start + 3);
            const dur = Math.max(0.5, end - start);
            const progress = Math.max(0, Math.min(1, (highlightTime - start) / dur));
            dots.forEach((dot, dIdx) => {
              const threshold = (dIdx + 1) / (dots.length + 1);
              dot.classList.toggle('active', progress >= threshold);
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
  }, [activeLyrics, isRich, lyricsSyncQuality, provenance, currentTrackId, currentTrack, lyricsSettings]);


  if (!currentTrack) return null;

  // Dynamic palette from CSS custom properties (updated on root via colorExtractor)
  const pillBg     = 'var(--art-pill-bg, rgba(25, 30, 42, 0.65))';
  const pillActive = 'var(--art-pill-active, rgba(255,255,255,0.22))';

  // Generate CSS styles from lyrics settings
  const customCSSVars = getLyricsCSSVars(lyricsSettings);

  const stageMode = lyricsSettings.stageMode || 'apple';

  const renderArtwork = (maxSize: number = 380, roundedClass: string = 'rounded-[22px]') => (
    <div
      className={`album-art shrink-0 overflow-hidden relative group w-full aspect-square ${roundedClass}`}
      style={{
        maxWidth: `${maxSize}px`,
        boxShadow: '0 32px 80px -12px rgba(var(--art-r, 124), var(--art-g, 124), var(--art-b, 255), 0.5)'
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={currentTrack.id}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full h-full"
        >
          <Artwork
            src={coverUrl}
            alt={currentTrack.title}
            size={500}
            className={`w-full h-full object-cover select-none ${roundedClass}`}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const renderMetadata = (isLarge: boolean = false) => (
    <div className="track-info min-w-0 w-full text-center flex flex-col items-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentTrack.id}
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -7 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center w-full"
        >
          <div className="flex items-center justify-center gap-3 w-full">
            <Link
              href={`/song/${encodeURIComponent(currentTrack.id)}`}
              onClick={handleClose}
              className={`title select-text truncate font-bold text-white hover:text-[--art-primary,#6366f1] hover:underline transition-colors tracking-tight cursor-pointer ${
                isLarge ? 'text-[28px] max-w-[440px]' : 'text-[26px] max-w-[360px]'
              }`}
              title={`View song page: ${currentTrack.title}`}
            >
              {currentTrack.title}
            </Link>
            <button
              type="button"
              onClick={toggleLike}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
              title={isLiked ? 'Liked' : 'Like'}
            >
              <Heart size={20} className={isLiked ? 'fill-white text-white' : 'text-white/60'} />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              title={
                downloadStatus === 'complete'
                  ? 'Downloaded!'
                  : downloadStatus === 'resolving' || downloadStatus === 'downloading'
                  ? 'Downloading...'
                  : 'Download song (320kbps)'
              }
            >
              {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
                <Loader2 size={18} className="animate-spin text-white" />
              ) : downloadStatus === 'complete' ? (
                <Check size={18} className="text-emerald-400" />
              ) : (
                <Download size={18} />
              )}
            </button>
            <button
              type="button"
              onClick={handleCopySongLink}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              title={copiedLink ? 'Song link copied!' : 'Copy song link'}
            >
              {copiedLink ? <Check size={18} className="text-emerald-400" /> : <Share2 size={18} />}
            </button>
          </div>
          <p
            className={`artist truncate mt-1 font-medium text-white/60 tracking-normal w-full ${
              isLarge ? 'text-[15px] max-w-[440px]' : 'text-[15px] max-w-[360px]'
            }`}
          >
            {rawTrack?.artists && rawTrack.artists.length > 0 && rawTrack.artists[0]?.id ? (
              <Link
                href={`/artist/${encodeURIComponent(rawTrack.artists[0].id)}`}
                onClick={handleClose}
                className="hover:text-white hover:underline transition-colors"
              >
                {currentTrack.artist}
              </Link>
            ) : (
              <span>{currentTrack.artist}</span>
            )}
            {rawTrack?.album_id ? (
              <>
                {' - '}
                <Link
                  href={`/album/${encodeURIComponent(rawTrack.album_id)}`}
                  onClick={handleClose}
                  className="hover:text-white hover:underline transition-colors"
                >
                  {rawTrack.album || currentTrack.album}
                </Link>
              </>
            ) : (
              currentTrack.album && currentTrack.album !== 'YouTube Music' ? ` - ${currentTrack.album}` : ''
            )}
          </p>
          {copiedLink && (
            <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded-full border border-emerald-500/30 mt-1">
              Song link copied to clipboard
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const renderControlsRow = (maxWidth: number = 380) => (
    <div
      className="hidden lg:flex items-center justify-between w-full px-1 text-white select-none"
      style={{ maxWidth: `${maxWidth}px` }}
    >
      {/* Left: Volume with hover slider & Up Next More button */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center group/vol">
          <button
            type="button"
            onClick={() => setMuted(!isMuted)}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX size={17} />
            ) : volume < 0.5 ? (
              <Volume1 size={17} />
            ) : (
              <Volume2 size={17} />
            )}
          </button>
          <div className="w-0 group-hover/vol:w-16 transition-all duration-200 overflow-hidden flex items-center">
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-16 h-1 accent-white cursor-pointer ml-1"
              aria-label="Volume level"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsDrawerOpen((prev) => !prev)}
          aria-label="Up next queue"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
          title="Up Next"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>

      {/* Center: Shuffle, Prev, Play/Pause, Next, Repeat */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggleShuffle}
          aria-label="Shuffle"
          className="w-7 h-7 flex items-center justify-center cursor-pointer transition-colors"
          title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
        >
          <Shuffle size={15} className={shuffle ? 'text-white' : 'text-white/35 hover:text-white/70'} />
        </button>

        <button
          type="button"
          onClick={skipPrev}
          aria-label="Previous"
          className="w-9 h-9 flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          title="Previous (P)"
        >
          <SkipBack size={21} fill="white" color="white" />
        </button>

        <button
          type="button"
          onClick={togglePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:scale-108 active:scale-95 transition-transform cursor-pointer"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isLoading ? (
            <Loader2 size={24} className="animate-spin text-white" />
          ) : isPlaying ? (
            <Pause size={28} fill="white" color="white" />
          ) : (
            <Play size={28} fill="white" color="white" className="ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={skipNext}
          aria-label="Next"
          className="w-9 h-9 flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-transform cursor-pointer"
          title="Next (N)"
        >
          <SkipForward size={21} fill="white" color="white" />
        </button>

        <button
          type="button"
          onClick={cycleRepeat}
          aria-label="Repeat mode"
          className="w-7 h-7 flex items-center justify-center cursor-pointer transition-colors"
          title={`Repeat: ${repeat}`}
        >
          {repeat === 'one' ? (
            <Repeat1 size={15} className="text-white" />
          ) : (
            <Repeat size={15} className={repeat === 'off' ? 'text-white/35 hover:text-white/70' : 'text-white'} />
          )}
        </button>
      </div>

      {/* Right: Heart, Download & Lyric Quote */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
          aria-label="Download song"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
          title={
            downloadStatus === 'complete'
              ? 'Downloaded!'
              : downloadStatus === 'resolving' || downloadStatus === 'downloading'
              ? 'Downloading...'
              : 'Download song (320kbps)'
          }
        >
          {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
            <Loader2 size={16} className="animate-spin text-white" />
          ) : downloadStatus === 'complete' ? (
            <Check size={16} className="text-emerald-400" />
          ) : (
            <Download size={16} />
          )}
        </button>

        <button
          type="button"
          onClick={toggleLike}
          aria-label={isLiked ? 'Unlike track' : 'Like track'}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
          title={isLiked ? 'Liked' : 'Favorite'}
        >
          <Heart
            size={17}
            className={isLiked ? 'fill-rose-500 text-rose-500' : 'text-white/50 hover:text-white'}
          />
        </button>

        <button
          type="button"
          onClick={() => setIsShareModalOpen(true)}
          aria-label="Create lyrics quote card"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
          title="Lyric Quote"
        >
          <MessageSquareQuote size={17} />
        </button>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.982 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.982 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`better-lyrics-page pt-12 md:pt-0 stage-mode-${stageMode} blyrics-layout-${lyricsSettings.layoutMode || 'split'} blyrics-bg-${lyricsSettings.backgroundStyle || 'wash'} ${lyricsSettings.showAccentBar ? 'blyrics-accent-bar' : ''} ${lyricsSettings.align === 'center' ? 'blyrics-align-center' : ''}`}
      style={{
        background: `
          radial-gradient(circle at 0% 0%, hsla(var(--art-h, 215), var(--art-s, 60%), 35%, 0.4) 0%, transparent 50%),
          radial-gradient(circle at 100% 100%, hsla(var(--art-h, 215), var(--art-s, 40%), 20%, 0.4) 0%, transparent 60%),
          #0a0a0f
        `,
        '--blyrics-background-img': coverUrl ? `url("${coverUrl}")` : 'none',
        ...customCSSVars,
      } as React.CSSProperties}
    >
      {/* Apple Music Authentic Multi-Layer Fluid Artwork Background */}
      <div className={`blyrics-fluid-canvas ${lyricsSettings.motionBackground === 'static' ? 'motion-static' : ''}`} aria-hidden="true">
        <div className="blyrics-fluid-layer blyrics-fluid-layer-1" />
        <div className="blyrics-fluid-layer blyrics-fluid-layer-2" />
        <div className="blyrics-fluid-layer blyrics-fluid-layer-3" />
      </div>

      {/* ── Desktop Top Controls (Screens >= lg) ── */}
      <div className="hidden lg:flex absolute top-7 right-8 z-[2000] items-center gap-2">
        {/* 3-Pill Mode Switcher: Apple | Vinyl | Cinema */}
        <div className="flex items-center bg-white/10 backdrop-blur-md rounded-full p-1 border border-white/15 shadow-lg">
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('apple')}
            aria-label="Apple mode (split lyrics and artwork)"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              stageMode === 'apple'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
            title="Apple Music 2-Column Split Mode (V to cycle)"
          >
            <Music2 size={13} />
            <span>Apple</span>
          </button>
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('vinyl')}
            aria-label="Vinyl mode (immersive vinyl artwork)"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              stageMode === 'vinyl'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
            title="Vinyl Artwork Immersion Mode (V to cycle)"
          >
            <Disc3 size={13} />
            <span>Vinyl</span>
          </button>
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('cinema')}
            aria-label="Cinema mode (focused sing view)"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
              stageMode === 'cinema'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
            title="Cinema Sing Focus Mode (V to cycle)"
          >
            <Mic2 size={13} />
            <span>Cinema</span>
          </button>
        </div>

        {/* 1-Click Script Switcher (Aa Romanized / Original) */}
        <button
          type="button"
          onClick={() => lyricsSettings.setShowRomanized(!lyricsSettings.showRomanized)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer shadow-sm ${
            lyricsSettings.showRomanized
              ? 'bg-white/20 border-white/35 text-white ring-1 ring-white/30'
              : 'bg-black/30 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
          }`}
          title={
            lyricsSettings.showRomanized
              ? 'Romanized (English letters) active · Click for Original Script'
              : 'Original Script active · Click for Romanized (English letters)'
          }
          aria-label="Toggle Romanized lyrics"
        >
          <span className="font-bold tracking-tight text-[12px] font-mono">Aa</span>
          <span className="hidden xl:inline text-[11px]">
            {lyricsSettings.showRomanized ? 'Roman' : 'Script'}
          </span>
        </button>

        {/* Direct Settings Link */}
        <Link
          href="/settings"
          onClick={handleClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Settings & Audio Calibration"
          aria-label="Settings"
        >
          <Sliders size={15} />
        </Link>

        <button
          type="button"
          onClick={toggleFullScreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title={isFullscreen ? 'Exit Full Screen (F)' : 'Full Screen (F)'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close lyrics"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Mobile Top Header (Screens < lg): Back Button, Mode Switcher, Settings ── */}
      <div className="flex lg:hidden absolute top-[calc(0.75rem+env(safe-area-inset-top,0px))] left-3 right-3 z-[2000] items-center justify-between pointer-events-auto">
        {/* Back / Close button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close player"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white shadow-md active:scale-95 transition-transform cursor-pointer"
        >
          <ChevronDown size={20} />
        </button>

        {/* Mobile Stage Mode Switcher (Apple | Vinyl | Cinema) */}
        <div className="flex items-center bg-black/40 backdrop-blur-xl rounded-full p-1 border border-white/15 shadow-md">
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('apple')}
            className={`flex items-center justify-center w-8 h-7 rounded-full transition-all cursor-pointer ${
              stageMode === 'apple'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white'
            }`}
            title="Apple Music Mode"
            aria-label="Apple Music Mode"
          >
            <Music2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('vinyl')}
            className={`flex items-center justify-center w-8 h-7 rounded-full transition-all cursor-pointer ${
              stageMode === 'vinyl'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white'
            }`}
            title="Vinyl Artwork Mode"
            aria-label="Vinyl Artwork Mode"
          >
            <Disc3 size={14} />
          </button>
          <button
            type="button"
            onClick={() => lyricsSettings.setStageMode('cinema')}
            className={`flex items-center justify-center w-8 h-7 rounded-full transition-all cursor-pointer ${
              stageMode === 'cinema'
                ? 'bg-white/25 text-white shadow-sm ring-1 ring-white/30'
                : 'text-white/50 hover:text-white'
            }`}
            title="Cinema Sing Mode"
            aria-label="Cinema Sing Mode"
          >
            <Mic2 size={14} />
          </button>
        </div>

        {/* Right: Script, Settings & Up Next */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => lyricsSettings.setShowRomanized(!lyricsSettings.showRomanized)}
            className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xl border text-xs font-bold font-mono shadow-md active:scale-95 transition-all cursor-pointer ${
              lyricsSettings.showRomanized
                ? 'bg-white/25 border-white/35 text-white ring-1 ring-white/30'
                : 'bg-black/40 border-white/15 text-white/60 hover:text-white'
            }`}
            title={lyricsSettings.showRomanized ? 'Romanized Active · Tap for Original' : 'Original Script · Tap to Romanize'}
            aria-label="Toggle Romanized lyrics"
          >
            Aa
          </button>
          <Link
            href="/settings"
            onClick={handleClose}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white/70 hover:text-white shadow-md active:scale-95 transition-all cursor-pointer"
            title="Settings"
            aria-label="Settings"
          >
            <Sliders size={15} />
          </Link>
          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-label="Up next queue"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white/70 hover:text-white shadow-md active:scale-95 transition-all cursor-pointer"
            title="Up Next"
          >
            <ListMusic size={15} />
          </button>
        </div>
      </div>

      {/* Side Panel: Album Art, Centered Metadata & Clean Controls (Apple Mode) */}
      <div className="blyrics-side-panel">
        <div className="w-full max-w-[380px] flex flex-col items-center gap-5">
          {/* Album Artwork */}
          {renderArtwork(380, 'rounded-[22px]')}

          {/* Track Title and Artist (Centered like Apple Music) */}
          {renderMetadata(false)}

          {/* Desktop Progress Seek Bar (Inline with time on left and right) */}
          <DesktopLyricsProgressBar duration={duration} seekTo={seekTo} />

          {/* Desktop Controls (Apple Music Unified Balanced Row) */}
          {renderControlsRow(380)}
        </div>
      </div>

      {/* ── Mode 2: Vinyl / Artwork Immersion Stage View ── */}
      {stageMode === 'vinyl' && (
        <div className="stage-vinyl-view">
          {/* Large Artwork with Halo Glow */}
          <div className="relative group w-full max-w-[390px] aspect-square rounded-[26px] overflow-hidden mb-6 shadow-2xl flex items-center justify-center">
            <div
              className="stage-vinyl-glow"
              style={{ background: 'hsla(var(--art-h, 215), var(--art-s, 60%), 50%, 0.45)' }}
            />
            {renderArtwork(390, 'rounded-[26px]')}
          </div>

          {/* Centered Metadata */}
          {renderMetadata(true)}

          {/* Centered Seek Progress Bar */}
          <div className="w-full max-w-[420px] mt-4 mb-2">
            <DesktopLyricsProgressBar duration={duration} seekTo={seekTo} className="max-w-[420px]" />
          </div>

          {/* Centered Controls Row */}
          <div className="w-full max-w-[420px] mb-4">
            {renderControlsRow(420)}
          </div>

          {/* 1-Line Real-Time Lyric Ticker Subtitle */}
          <div className="w-full max-w-[460px] min-h-[34px] flex items-center justify-center text-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={currentTickerLine || 'empty-ticker'}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="text-sm lg:text-base font-medium text-white/85 tracking-wide truncate px-4"
              >
                {currentTickerLine ? (
                  <span>{currentTickerLine}</span>
                ) : (
                  <span className="text-white/35 text-xs italic">♪ Instrumental or listening</span>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      )}

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
                  showInstrumentalCountdown={lyricsSettings.showInstrumentalCountdown}
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

      {/* ── Mode 3: Cinema Floating Bottom Dock ── */}
      {stageMode === 'cinema' && (
        <div className="hidden lg:flex stage-cinema-dock">
          {/* Mini Artwork + Meta */}
          <div className="flex items-center gap-3 min-w-0 pr-3 border-r border-white/10 max-w-[220px]">
            <Artwork
              src={coverUrl}
              alt={currentTrack.title}
              size={38}
              className="w-[38px] h-[38px] rounded-lg object-cover shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{currentTrack.title}</p>
              <p className="text-[11px] text-white/60 truncate">{currentTrack.artist}</p>
            </div>
          </div>

          {/* Mini Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={skipPrev}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Previous (P)"
            >
              <SkipBack size={16} fill="white" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin text-black" />
              ) : isPlaying ? (
                <Pause size={18} fill="black" />
              ) : (
                <Play size={18} fill="black" className="ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={skipNext}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Next (N)"
            >
              <SkipForward size={16} fill="white" />
            </button>
          </div>

          {/* Mini Progress */}
          <div className="w-48 pl-2">
            <DesktopLyricsProgressBar duration={duration} seekTo={seekTo} className="max-w-[190px]" />
          </div>

          {/* Like & Up next */}
          <div className="flex items-center gap-1 pl-2 border-l border-white/10">
            <button
              type="button"
              onClick={toggleLike}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
              title={isLiked ? 'Liked' : 'Favorite'}
            >
              <Heart size={15} className={isLiked ? 'fill-rose-500 text-rose-500' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setIsDrawerOpen((prev) => !prev)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
              title="Up Next"
            >
              <ListMusic size={15} />
            </button>
          </div>
        </div>
      )}

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

      {/* ── Share Lyrics Quote Card Modal ── */}
      <LyricShareCardModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        track={currentTrack}
        lyrics={activeLyrics}
        initialActiveIndex={lastActiveIdx.current >= 0 ? lastActiveIdx.current : 0}
      />
    </motion.div>
  );
}

