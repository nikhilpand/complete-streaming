'use client';

import { create } from 'zustand';
import type { Song } from '@/lib/api/types';
import { sendTelemetry } from '@/lib/api/telemetry';
import { artistNames } from '@/lib/utils';

const STORAGE_KEY = 'sway_liked_songs_v1';

interface LikedSongsState {
  likedSongs: Song[];
  likedIds: Set<string>;
  isHydrated: boolean;
  isLiked: (songId?: string | null) => boolean;
  toggleLike: (song: Song) => void;
  removeLike: (songId: string) => void;
}

function loadInitialLikes(): Song[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to parse liked songs from localStorage', e);
  }
  return [];
}

function saveLikes(songs: Song[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch (e) {
    console.warn('Failed to save liked songs to localStorage', e);
  }
}

export const useLikedSongs = create<LikedSongsState>((set, get) => ({
  likedSongs: [],
  likedIds: new Set<string>(),
  isHydrated: false,

  isLiked: (songId?: string | null) => {
    if (!songId) return false;
    return get().likedIds.has(songId);
  },

  toggleLike: (song: Song) => {
    if (!song || !song.id) return;
    const { likedSongs, likedIds } = get();
    const isCurrentlyLiked = likedIds.has(song.id);

    let updatedSongs: Song[];
    let updatedIds: Set<string>;

    if (isCurrentlyLiked) {
      updatedSongs = likedSongs.filter((s) => s.id !== song.id);
      updatedIds = new Set(updatedSongs.map((s) => s.id));
      try {
        localStorage.removeItem(`sway_liked_${song.id}`);
      } catch {}
      sendTelemetry({
        event_type: 'unlike',
        track_id: song.id,
        title: song.title,
        artist: artistNames(song.artists, song.subtitle),
      });
    } else {
      updatedSongs = [song, ...likedSongs.filter((s) => s.id !== song.id)];
      updatedIds = new Set(updatedSongs.map((s) => s.id));
      try {
        localStorage.setItem(`sway_liked_${song.id}`, 'true');
      } catch {}
      sendTelemetry({
        event_type: 'like',
        track_id: song.id,
        title: song.title,
        artist: artistNames(song.artists, song.subtitle),
      });
    }

    saveLikes(updatedSongs);
    set({ likedSongs: updatedSongs, likedIds: updatedIds });
  },

  removeLike: (songId: string) => {
    const { likedSongs } = get();
    const updatedSongs = likedSongs.filter((s) => s.id !== songId);
    const updatedIds = new Set(updatedSongs.map((s) => s.id));
    try {
      localStorage.removeItem(`sway_liked_${songId}`);
    } catch {}
    saveLikes(updatedSongs);
    set({ likedSongs: updatedSongs, likedIds: updatedIds });
  },
}));

// Hydrate client-side once mounted
if (typeof window !== 'undefined') {
  const initial = loadInitialLikes();
  useLikedSongs.setState({
    likedSongs: initial,
    likedIds: new Set(initial.map((s) => s.id)),
    isHydrated: true,
  });

  // Cross-tab sync
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      const updated = loadInitialLikes();
      useLikedSongs.setState({
        likedSongs: updated,
        likedIds: new Set(updated.map((s) => s.id)),
      });
    }
  });
}
