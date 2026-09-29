import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface IntegrationSettingsState {
  // Last.fm
  lastFmEnabled: boolean;
  lastFmUsername: string;
  lastFmSessionKey: string;
  setLastFmEnabled: (enabled: boolean) => void;
  setLastFmCredentials: (username: string, sessionKey: string) => void;

  // ListenBrainz
  listenBrainzEnabled: boolean;
  listenBrainzToken: string;
  setListenBrainzEnabled: (enabled: boolean) => void;
  setListenBrainzToken: (token: string) => void;

  // Discord Rich Presence
  discordRpcEnabled: boolean;
  setDiscordRpcEnabled: (enabled: boolean) => void;
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

export const useIntegrationSettings = create<IntegrationSettingsState>()(
  persist(
    (set) => ({
      lastFmEnabled: false,
      lastFmUsername: '',
      lastFmSessionKey: '',
      setLastFmEnabled: (enabled) => set({ lastFmEnabled: enabled }),
      setLastFmCredentials: (username, sessionKey) =>
        set({ lastFmUsername: username, lastFmSessionKey: sessionKey, lastFmEnabled: !!sessionKey }),

      listenBrainzEnabled: false,
      listenBrainzToken: '',
      setListenBrainzEnabled: (enabled) => set({ listenBrainzEnabled: enabled }),
      setListenBrainzToken: (token) =>
        set({ listenBrainzToken: token, listenBrainzEnabled: !!token }),

      discordRpcEnabled: false,
      setDiscordRpcEnabled: (enabled) => set({ discordRpcEnabled: enabled }),
    }),
    {
      name: 'sway-integrations-v1',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
    }
  )
);
