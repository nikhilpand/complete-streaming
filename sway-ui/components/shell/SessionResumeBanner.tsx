'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { artistNames } from '@/lib/utils';

/**
 * SessionResumeBanner — Sprint 1
 *
 * Shown once on app mount when a persisted session exists.
 * Does NOT auto-play — user must click Resume.
 * Dismisses after 8 seconds or on click.
 */
export function SessionResumeBanner() {
  const [visible, setVisible] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const play = usePlayerStore((s) => s.play);
  const status = usePlayerStore((s) => s.status);

  // Show banner once on mount if there's a persisted track and we're idle
  useEffect(() => {
    // Small delay to allow hydration to settle
    const t = setTimeout(() => {
      const state = usePlayerStore.getState();
      if (state.currentTrack && state.status === 'idle') {
        setVisible(true);
      }
    }, 600);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss after 8s
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [visible]);

  // Hide when playback starts
  useEffect(() => {
    if (status === 'playing') {
      setVisible(false);
    }
  }, [status]);

  const handleResume = () => {
    setVisible(false);
    play();
  };

  const handleDismiss = () => setVisible(false);

  if (!currentTrack) return null;

  const artist = artistNames(currentTrack.artists, currentTrack.subtitle);
  const resumeAtStr =
    currentTime > 3
      ? ` · ${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, '0')}`
      : '';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="resume-banner"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2.5 px-3 py-2 rounded-full bg-[--surface] border border-white/[0.08] shadow-2xl backdrop-blur-xl text-sm max-w-[90vw]"
          role="status"
          aria-label="Resume previous session"
        >
          <div className="min-w-0 flex-1">
            <span className="text-[--muted] text-xs">Resume: </span>
            <span className="text-[--foreground] font-medium text-xs truncate">
              {currentTrack.title}
            </span>
            <span className="text-[--muted] text-xs"> — {artist}{resumeAtStr}</span>
          </div>
          <button
            onClick={handleResume}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[--foreground] text-[--surface] text-xs font-semibold hover:opacity-90 transition-opacity flex-shrink-0"
          >
            <Play className="w-3 h-3 fill-current" />
            Resume
          </button>
          <button
            onClick={handleDismiss}
            className="w-6 h-6 flex items-center justify-center rounded-full text-[--muted] hover:text-[--foreground] hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
