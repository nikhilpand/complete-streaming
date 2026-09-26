'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePlayerStore } from '@/store/playerStore';
import { FullScreenLyrics } from '@/components/player/FullScreenLyrics';
import { Music2, Play, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function LyricsPage() {
  const router = useRouter();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isLyricsOpen = usePlayerStore((s) => s.isLyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  useEffect(() => {
    // If navigating directly to /lyrics and isLyricsOpen was false, enable it
    if (currentTrack && !isLyricsOpen) {
      usePlayerStore.setState({ isLyricsOpen: true });
    }
  }, [currentTrack, isLyricsOpen]);

  if (currentTrack) {
    return (
      <div className="relative w-full h-full min-h-screen">
        <FullScreenLyrics onClose={() => router.push('/')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center select-none">
      <div className="w-20 h-20 rounded-3xl bg-white/[0.05] border border-white/10 flex items-center justify-center mb-6 shadow-2xl backdrop-blur-xl">
        <Music2 size={36} className="text-white/60 animate-pulse" />
      </div>

      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
        Synchronized Lyrics
      </h1>
      <p className="text-sm sm:text-base text-white/60 max-w-md mb-8 leading-relaxed">
        Play any song to experience cinematic word-by-word karaoke, fluid ambient atmospheres, and customizable typography.
      </p>

      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 active:scale-95 transition-all shadow-lg cursor-pointer"
        >
          <Play size={16} fill="black" />
          <span>Discover Music</span>
        </Link>
        <Link
          href="/search"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 text-white font-semibold text-sm border border-white/15 transition-all cursor-pointer"
        >
          <Sparkles size={16} className="text-amber-400" />
          <span>Search Songs</span>
        </Link>
      </div>
    </div>
  );
}
