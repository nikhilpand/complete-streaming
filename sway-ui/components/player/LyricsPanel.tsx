'use client';

import { usePlayerStore } from '@/store/playerStore';
import { FullScreenLyrics } from './FullScreenLyrics';
import { AnimatePresence } from 'framer-motion';

export function LyricsPanel() {
  const isOpen = usePlayerStore((s) => s.isLyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  return (
    <AnimatePresence>
      {isOpen && (
        <FullScreenLyrics onClose={toggleLyrics} />
      )}
    </AnimatePresence>
  );
}
