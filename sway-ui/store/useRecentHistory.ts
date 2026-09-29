'use client';

import { create } from 'zustand';
import type { Song } from '@/lib/api/types';

export interface HistoryItem {
  song: Song;
  playedAt: number;
}

const STORAGE_KEY = 'sway_recent_history_v1';
const MAX_HISTORY = 50;

interface RecentHistoryState {
  history: HistoryItem[];
  isHydrated: boolean;
  addHistory: (song: Song) => void;
  clearHistory: () => void;
  removeHistoryItem: (songId: string) => void;
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  return null;
}

function loadHistory(): HistoryItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse listening history from localStorage', err);
  }
  return [];
}

function saveHistory(history: HistoryItem[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('Failed to persist listening history to localStorage', err);
  }
}

export const useRecentHistory = create<RecentHistoryState>((set, get) => {
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        set({ history: loadHistory() });
      }
    });
  }

  return {
    history: loadHistory(),
    isHydrated: typeof window !== 'undefined',

    addHistory: (song: Song) => {
      if (!song || !song.id) return;
      const current = get().history;
      // Deduplicate: filter out previous occurrence of same song
      const filtered = current.filter((item) => item.song.id !== song.id);
      const updated = [{ song, playedAt: Date.now() }, ...filtered].slice(0, MAX_HISTORY);

      set({ history: updated });
      saveHistory(updated);
    },

    clearHistory: () => {
      set({ history: [] });
      saveHistory([]);
    },

    removeHistoryItem: (songId: string) => {
      const updated = get().history.filter((item) => item.song.id !== songId);
      set({ history: updated });
      saveHistory(updated);
    },
  };
});
