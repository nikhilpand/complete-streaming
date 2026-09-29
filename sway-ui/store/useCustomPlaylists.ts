'use client';

import { create } from 'zustand';
import type { Song } from '@/lib/api/types';

export interface CustomPlaylist {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  songs: Song[];
}

const STORAGE_KEY = 'sway_custom_playlists_v1';

interface CustomPlaylistsState {
  playlists: CustomPlaylist[];
  isHydrated: boolean;
  createPlaylist: (title: string, description?: string, initialSongs?: Song[]) => string;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, newTitle: string, description?: string) => void;
  addSongToPlaylist: (playlistId: string, song: Song) => void;
  removeSongFromPlaylist: (playlistId: string, songId: string) => void;
  reorderPlaylistSongs: (playlistId: string, fromIndex: number, toIndex: number) => void;
  getPlaylist: (id: string) => CustomPlaylist | undefined;
  isSongInPlaylist: (playlistId: string, songId: string) => boolean;
  updatePlaylistSongs: (playlistId: string, songs: Song[]) => void;
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  return null;
}

function loadPlaylists(): CustomPlaylist[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse custom playlists from localStorage', err);
  }
  return [];
}

function savePlaylists(playlists: CustomPlaylist[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch (err) {
    console.warn('Failed to persist custom playlists to localStorage', err);
  }
}

export const useCustomPlaylists = create<CustomPlaylistsState>((set, get) => {
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        set({ playlists: loadPlaylists() });
      }
    });
  }

  return {
    playlists: loadPlaylists(),
    isHydrated: typeof window !== 'undefined',

    createPlaylist: (title: string, description?: string, initialSongs: Song[] = []) => {
      const cleanTitle = title.trim() || 'Untitled Playlist';
      const id = `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newPlaylist: CustomPlaylist = {
        id,
        title: cleanTitle,
        description: description?.trim() || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        songs: initialSongs,
      };

      const updated = [newPlaylist, ...get().playlists];
      set({ playlists: updated });
      savePlaylists(updated);
      return id;
    },

    deletePlaylist: (id: string) => {
      const updated = get().playlists.filter((p) => p.id !== id);
      set({ playlists: updated });
      savePlaylists(updated);
    },

    renamePlaylist: (id: string, newTitle: string, description?: string) => {
      const cleanTitle = newTitle.trim();
      if (!cleanTitle) return;
      const updated = get().playlists.map((p) => {
        if (p.id !== id) return p;
        return {
          ...p,
          title: cleanTitle,
          description: description !== undefined ? description.trim() : p.description,
          updatedAt: Date.now(),
        };
      });
      set({ playlists: updated });
      savePlaylists(updated);
    },

    addSongToPlaylist: (playlistId: string, song: Song) => {
      if (!song || !song.id) return;
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        // Avoid duplicate additions
        if (p.songs.some((s) => s.id === song.id)) return p;
        return {
          ...p,
          songs: [...p.songs, song],
          updatedAt: Date.now(),
        };
      });
      set({ playlists: updated });
      savePlaylists(updated);
    },

    removeSongFromPlaylist: (playlistId: string, songId: string) => {
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          songs: p.songs.filter((s) => s.id !== songId),
          updatedAt: Date.now(),
        };
      });
      set({ playlists: updated });
      savePlaylists(updated);
    },

    reorderPlaylistSongs: (playlistId: string, fromIndex: number, toIndex: number) => {
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        if (fromIndex < 0 || fromIndex >= p.songs.length || toIndex < 0 || toIndex >= p.songs.length) {
          return p;
        }
        const cloned = [...p.songs];
        const [moved] = cloned.splice(fromIndex, 1);
        cloned.splice(toIndex, 0, moved);
        return {
          ...p,
          songs: cloned,
          updatedAt: Date.now(),
        };
      });
      set({ playlists: updated });
      savePlaylists(updated);
    },

    getPlaylist: (id: string) => {
      return get().playlists.find((p) => p.id === id);
    },

    isSongInPlaylist: (playlistId: string, songId: string) => {
      const pl = get().playlists.find((p) => p.id === playlistId);
      if (!pl) return false;
      return pl.songs.some((s) => s.id === songId);
    },

    updatePlaylistSongs: (playlistId: string, songs: Song[]) => {
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          songs,
          updatedAt: Date.now(),
        };
      });
      set({ playlists: updated });
      savePlaylists(updated);
    },
  };
});
