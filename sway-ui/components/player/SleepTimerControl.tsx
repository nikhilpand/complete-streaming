'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Moon, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '@/store/playerStore';
import { SleepTimer } from '@/lib/playback/SleepTimer';
import { cn } from '@/lib/utils';

const PRESETS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '60 min', minutes: 60 },
  { label: 'End of track', minutes: -1 },
] as const;

function formatRemaining(ms: number): string {
  if (!isFinite(ms)) return 'After current song';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function SleepTimerControl() {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState<number>(0);
  const timerRef = useRef<SleepTimer | null>(null);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const sleepTimerActive = usePlayerStore((s) => s.sleepTimerActive);
  const status = usePlayerStore((s) => s.status);

  // Initialize SleepTimer singleton
  useEffect(() => {
    timerRef.current = new SleepTimer(
      (remainingMs) => {
        setRemaining(remainingMs);
        setSleepTimer(true, isFinite(remainingMs) ? remainingMs : 0);
      },
      () => {
        setRemaining(0);
        setSleepTimer(false, 0);
      }
    );
    return () => {
      timerRef.current?.clear();
    };
  }, [setSleepTimer]);

  // End-of-track mode: trigger on track end
  useEffect(() => {
    if (
      sleepTimerActive &&
      timerRef.current?.isEndOfTrackMode() &&
      status === 'idle'
    ) {
      timerRef.current.expireNow();
    }
  }, [status, sleepTimerActive]);

  const handlePreset = useCallback(
    (minutes: number) => {
      if (minutes === -1) {
        timerRef.current?.startEndOfTrack();
        setSleepTimer(true, 0);
        setRemaining(Infinity);
      } else {
        timerRef.current?.start(minutes);
        setSleepTimer(true, minutes * 60 * 1000);
        setRemaining(minutes * 60 * 1000);
      }
      setOpen(false);
    },
    [setSleepTimer]
  );

  const handleCancel = useCallback(() => {
    timerRef.current?.clear();
    setSleepTimer(false, 0);
    setRemaining(0);
    setOpen(false);
  }, [setSleepTimer]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-[--radius-sm] text-xs transition-colors',
          sleepTimerActive
            ? 'text-[--art-primary] bg-[--art-primary]/10 hover:bg-[--art-primary]/20'
            : 'text-[--muted] hover:text-[--foreground] hover:bg-white/10'
        )}
        title={sleepTimerActive ? `Sleep timer: ${formatRemaining(remaining)}` : 'Sleep timer'}
        aria-label="Sleep timer"
      >
        <Moon className="w-3.5 h-3.5" />
        {sleepTimerActive && (
          <span className="tabular-nums font-mono text-[10px]">
            {formatRemaining(remaining)}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 340, damping: 26 }}
            className="absolute bottom-full mb-2 right-0 w-52 rounded-[--radius-lg] bg-[--surface] border border-white/[0.08] shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
              <div className="flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-[--muted]" />
                <span className="text-xs font-medium text-[--foreground]">Sleep Timer</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[--muted] hover:text-[--foreground] transition-colors"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Presets */}
            <div className="p-1.5 space-y-0.5">
              {PRESETS.map(({ label, minutes }) => (
                <button
                  key={label}
                  onClick={() => handlePreset(minutes)}
                  className="w-full text-left px-3 py-2 rounded-[--radius-sm] text-xs text-[--foreground] hover:bg-white/[0.06] transition-colors flex items-center justify-between group"
                >
                  <span>{label}</span>
                  {sleepTimerActive &&
                    ((minutes === -1 && timerRef.current?.isEndOfTrackMode()) ||
                      (minutes !== -1 &&
                        !timerRef.current?.isEndOfTrackMode() &&
                        Math.abs(
                          (timerRef.current?.getRemainingMs() ?? 0) - minutes * 60 * 1000
                        ) < minutes * 60 * 1000 * 0.1)) && (
                      <span className="text-[--art-primary] text-[9px] font-medium">active</span>
                    )}
                </button>
              ))}
            </div>

            {/* Active timer controls */}
            {sleepTimerActive && (
              <div className="px-3 py-2.5 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[--muted]">
                    Stops in{' '}
                    <span className="text-[--foreground] font-mono">
                      {formatRemaining(remaining)}
                    </span>
                  </span>
                  <button
                    onClick={handleCancel}
                    className="text-[10px] text-red-400 hover:text-red-300 transition-colors px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
    </div>
  );
}
