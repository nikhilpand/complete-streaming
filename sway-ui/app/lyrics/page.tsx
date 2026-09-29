'use client';

import React from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Music2, Play, Sparkles, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import { Artwork } from '@/components/artwork/Artwork';
import { artistNames } from '@/lib/utils';

export default function LyricsPage() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  if (currentTrack) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[75vh] px-6 text-center select-none py-12">
        <div className="relative group mb-6">
          <Artwork
            src={currentTrack.artwork_url}
            alt={currentTrack.title}
            size={180}
            className="rounded-3xl shadow-2xl ring-1 ring-white/10"
          />
          <button
            onClick={toggleLyrics}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl flex items-center justify-center text-white cursor-pointer"
            aria-label="Open Fullscreen Lyrics"
          >
            <Maximize2 size={32} />
          </button>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1 max-w-lg truncate">
          {currentTrack.title}
        </h1>
        <p className="text-sm text-white/60 mb-6">
          {artistNames(currentTrack.artists)}
        </p>

        <button
          onClick={toggleLyrics}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[--art-primary,#6366f1] text-white font-semibold text-sm hover:brightness-110 active:scale-95 transition-all shadow-lg cursor-pointer"
        >
          <Maximize2 size={16} />
          <span>Open Fullscreen Lyrics Stage</span>
        </button>
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
