/**
 * LyricsStage.jsx - Turnkey Apple Music & Spicy Lyrics React Component
 * Drop-in lyrics stage with dynamic atmosphere canvas, syllable karaoke sweeps,
 * smooth lerp auto-scrolling, and interactive controls HUD.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLyrics } from './useLyrics.js';
import { ColorExtractor } from '../visuals/ColorExtractor.js';
import { AmbientBackground } from '../visuals/AmbientBackground.js';

export function LyricsStage({
  track,
  currentTimeMs = 0,
  isPlaying = false,
  onSeek = () => {},
  className = '',
  style = {},
  showHud = false
}) {
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const stageRef = useRef(null);
  const ambientBgRef = useRef(null);

  const [fontSize, setFontSize] = useState(28);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimerRef = useRef(null);

  // Use the lyrics hook
  const {
    lyrics,
    activeLine,
    activeIndex,
    isLoading,
    provider,
    offsetMs,
    setOffsetMs
  } = useLyrics({ track, currentTimeMs, isPlaying });

  // 1. Initialize Ambient Canvas Background
  useEffect(() => {
    if (!containerRef.current) return;
    if (!ambientBgRef.current) {
      ambientBgRef.current = new AmbientBackground(containerRef.current);
    }

    if (isPlaying) {
      ambientBgRef.current.start();
    } else {
      ambientBgRef.current.stop();
    }
  }, [isPlaying]);

  // 2. Extract album art palette on track change
  useEffect(() => {
    if (track?.albumArt && ambientBgRef.current) {
      ColorExtractor.extractPalette(track.albumArt).then((palette) => {
        ambientBgRef.current?.setPalette(palette);
      });
    }
  }, [track?.albumArt]);

  // 3. Smooth Lerp Auto-Scrolling
  const currentScrollY = useRef(0);
  const targetScrollY = useRef(0);

  const resumeAutoScroll = useCallback(() => {
    setIsUserScrolling(false);
    clearTimeout(userScrollTimerRef.current);
  }, []);

  const handleManualScroll = useCallback(() => {
    setIsUserScrolling(true);
    clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = setTimeout(() => {
      resumeAutoScroll();
    }, 4500);
  }, [resumeAutoScroll]);

  // Update target scroll when active index changes
  useEffect(() => {
    if (activeIndex >= 0 && stageRef.current && wrapperRef.current && !isUserScrolling) {
      const activeEl = stageRef.current.children[activeIndex];
      if (activeEl) {
        const wrapperHeight = wrapperRef.current.clientHeight;
        targetScrollY.current = Math.max(0, activeEl.offsetTop - wrapperHeight * 0.35);
      }
    }
  }, [activeIndex, isUserScrolling]);

  // 60fps Physics Lerp Loop
  useEffect(() => {
    let rafId = null;

    const loop = () => {
      if (!isUserScrolling && stageRef.current) {
        const diff = targetScrollY.current - currentScrollY.current;
        if (Math.abs(diff) > 0.5) {
          currentScrollY.current += diff * 0.12;
          stageRef.current.style.transform = `translate3d(0, ${-currentScrollY.current.toFixed(2)}px, 0)`;
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isUserScrolling]);

  // 4. Syllable Karaoke Fill Percentage Calculations
  const getWordFill = (word) => {
    const adjustedTime = currentTimeMs + offsetMs;
    if (adjustedTime >= word.endTime) return '100%';
    if (adjustedTime < word.startTime) return '0%';
    const dur = Math.max(1, word.endTime - word.startTime);
    const pct = ((adjustedTime - word.startTime) / dur) * 100;
    return `${pct.toFixed(1)}%`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className={`lyrics-stage-container ${className}`}
      style={{ '--lyrics-font-size': `${fontSize}px`, ...style }}
    >
      {/* Scrollable Stage Wrapper */}
      <div
        ref={wrapperRef}
        className="lyrics-scroll-wrapper"
        onWheel={handleManualScroll}
        onTouchMove={handleManualScroll}
      >
        <div ref={stageRef} className="lyrics-stage">
          {isLoading && (
            <div className="lyrics-empty-state">Searching lyrics databases...</div>
          )}

          {!isLoading && (!lyrics || !lyrics.lines.length) && (
            <div className="lyrics-empty-state">No synchronized lyrics available</div>
          )}

          {!isLoading && lyrics?.lines?.map((line, idx) => {
            const isPast = activeIndex > idx;
            const isActive = activeIndex === idx;
            const isUpcoming = activeIndex < idx;

            const stateClass = isActive ? 'active' : isPast ? 'past' : 'upcoming';

            return (
              <div
                key={idx}
                className={`lyric-line ${stateClass}`}
                onClick={() => {
                  onSeek(line.time);
                  resumeAutoScroll();
                }}
              >
                {line.words && line.words.length > 0 ? (
                  line.words.map((w, wIdx) => {
                    const fill = isActive ? getWordFill(w) : isPast ? '100%' : '0%';
                    return (
                      <span
                        key={wIdx}
                        className="lyric-word"
                        style={{ '--fill': fill }}
                      >
                        {w.text}{' '}
                      </span>
                    );
                  })
                ) : (
                  line.text
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Resume Sync Pill */}
      {isUserScrolling && (
        <button className="lyrics-sync-pill" onClick={resumeAutoScroll}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          <span>Sync to Now</span>
        </button>
      )}

      {/* Floating Controls HUD (Optional) */}
      {showHud && (
        <div className="lyrics-controls-hud">
          <div className="hud-pill">
            <div className="hud-section" title="Active Provider">
              <span className="hud-dot"></span>
              <span className="hud-provider-text">
                {isLoading ? 'Loading...' : `${provider || 'Ready'}`}
              </span>
            </div>

            <div className="hud-divider"></div>

            {/* Timing Offset (+/- ms) */}
            <div className="hud-section">
              <button
                className="hud-btn"
                title="Delay lyrics 100ms"
                onClick={() => setOffsetMs(offsetMs - 100)}
              >
                −
              </button>
              <span
                className="hud-offset-val"
                title="Click to reset offset"
                onClick={() => setOffsetMs(0)}
              >
                {offsetMs >= 0 ? `+${offsetMs}` : offsetMs}ms
              </span>
              <button
                className="hud-btn"
                title="Advance lyrics 100ms"
                onClick={() => setOffsetMs(offsetMs + 100)}
              >
                +
              </button>
            </div>

            <div className="hud-divider"></div>

            {/* Font Scaling */}
            <div className="hud-section">
              <button
                className="hud-btn"
                title="Smaller text"
                onClick={() => setFontSize(Math.max(18, fontSize - 2))}
              >
                A−
              </button>
              <button
                className="hud-btn"
                title="Larger text"
                onClick={() => setFontSize(Math.min(46, fontSize + 2))}
              >
                A+
              </button>
            </div>

            <div className="hud-divider"></div>

            {/* Fullscreen Button */}
            <div className="hud-section">
              <button
                className="hud-btn"
                title="Toggle Fullscreen"
                onClick={toggleFullscreen}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
