'use client';

import { usePlayback } from '@/lib/hooks/usePlayback';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';

export function PlaybackController() {
  usePlayback();
  useKeyboardShortcuts();
  return null;
}
