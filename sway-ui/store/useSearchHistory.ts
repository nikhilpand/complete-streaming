import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const MAX_SEARCH_HISTORY = 20;

interface SearchHistoryState {
  queries: string[];
  addQuery: (query: string) => void;
  removeQuery: (query: string) => void;
  clearHistory: () => void;
}

const memStore = new Map<string, string>();
const safeStorage = {
  getItem: (name: string): string | null => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(name);
      } catch {}
    }
    return memStore.get(name) ?? null;
  },
  setItem: (name: string, value: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(name, value);
        return;
      } catch {}
    }
    memStore.set(name, value);
  },
  removeItem: (name: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(name);
        return;
      } catch {}
    }
    memStore.delete(name);
  },
};

export const useSearchHistory = create<SearchHistoryState>()(
  persist(
    (set) => ({
      queries: [],
      addQuery: (q: string) => {
        const trimmed = q.trim();
        if (!trimmed || trimmed.length < 2) return;
        set((state) => {
          const filtered = state.queries.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
          return {
            queries: [trimmed, ...filtered].slice(0, MAX_SEARCH_HISTORY),
          };
        });
      },
      removeQuery: (q: string) =>
        set((state) => ({
          queries: state.queries.filter((item) => item !== q),
        })),
      clearHistory: () => set({ queries: [] }),
    }),
    {
      name: 'sway-search-history-v1',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
    }
  )
);
