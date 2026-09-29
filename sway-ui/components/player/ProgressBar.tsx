'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { formatSecs } from '@/lib/utils';

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef<boolean>(false);
  const [isHovered, setIsHovered] = useState(false);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Direct DOM updates on audioManager timeupdate for ultra-smooth 144fps playback with 0 React re-renders
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('@/lib/audio/AudioManager').then(({ audioManager }) => {
      if (!audioManager) return;
      unsub = audioManager.subscribe((ev) => {
        if (ev.type === 'timeupdate' && !isScrubbingRef.current) {
          const d = ev.duration || duration;
          if (d > 0) {
            const p = Math.min(100, Math.max(0, (ev.currentTime / d) * 100));
            if (fillRef.current) fillRef.current.style.width = `${p}%`;
          }
        }
      });
    });
    return () => {
      unsub?.();
    };
  }, [duration]);

  const calculateTimeFromEvent = useCallback(
    (clientX: number): number | null => {
      if (!trackRef.current || !duration) return null;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const updateVisualPosition = useCallback(
    (time: number) => {
      if (duration > 0 && fillRef.current) {
        const ratio = Math.max(0, Math.min(1, time / duration));
        fillRef.current.style.width = `${ratio * 100}%`;
      }
    },
    [duration]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!duration) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isScrubbingRef.current = true;
      const time = calculateTimeFromEvent(e.clientX);
      if (time !== null) {
        updateVisualPosition(time);
      }
    },
    [duration, calculateTimeFromEvent, updateVisualPosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isScrubbingRef.current || !duration) return;
      const time = calculateTimeFromEvent(e.clientX);
      if (time !== null) {
        updateVisualPosition(time);
      }
    },
    [duration, calculateTimeFromEvent, updateVisualPosition]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isScrubbingRef.current) return;
      isScrubbingRef.current = false;
      const time = calculateTimeFromEvent(e.clientX);
      if (time !== null) {
        usePlayerStore.getState().seekTo(time);
        updateVisualPosition(time);
      }
    },
    [calculateTimeFromEvent, updateVisualPosition]
  );

  return (
    <div
      ref={trackRef}
      className="absolute top-0 left-0 right-0 h-4 -translate-y-[2px] flex items-center cursor-pointer group z-50 touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="slider"
      aria-label="Seek track"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${formatSecs(currentTime)} of ${formatSecs(duration)}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!duration) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          usePlayerStore.getState().seekTo(Math.max(0, currentTime - 5));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          usePlayerStore.getState().seekTo(Math.min(duration, currentTime + 5));
        }
      }}
    >
      <div className="w-full h-[2px] group-hover:h-[4px] bg-white/10 transition-all relative">
        <div
          ref={fillRef}
          data-art-transition
          className="h-full bg-[--art-primary] relative"
          style={{ width: `${pct}%` }}
        >
          {/* Tactile drag thumb visible on hover or active scrub */}
          <div
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md transition-opacity duration-150 ${
              isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
