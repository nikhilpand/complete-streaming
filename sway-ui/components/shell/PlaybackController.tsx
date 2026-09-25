'use client';
import { usePlayback } from '@/lib/hooks/usePlayback';

export function PlaybackController() {
  usePlayback();
  return null;
}
