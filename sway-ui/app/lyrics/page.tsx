'use client';

import { FullScreenLyrics } from '@/components/player/FullScreenLyrics';
import { useRouter } from 'next/navigation';

export default function LyricsPage() {
  const router = useRouter();

  return (
    <FullScreenLyrics onClose={() => router.push('/')} />
  );
}
