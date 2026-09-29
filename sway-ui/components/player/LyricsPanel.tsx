'use client';

import { usePlayerStore } from '@/store/playerStore';
import { FullScreenLyrics } from './FullScreenLyrics';
import { AnimatePresence } from 'framer-motion';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

export function LyricsPanel() {
  const isOpen = usePlayerStore((s) => s.isLyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  useOverlayHistory(isOpen, () => usePlayerStore.setState({ isLyricsOpen: false }), 'lyrics');

  return (
    <AnimatePresence>
      {isOpen && (
        <FullScreenLyrics onClose={toggleLyrics} />
      )}
    </AnimatePresence>
  );
}
