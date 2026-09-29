import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CrossfadeDuration = 0 | 1 | 3 | 5 | 8 | 12;

export type EQPresetName =
  | 'Flat'
  | 'Bass Boost'
  | 'Acoustic'
  | 'Vocal'
  | 'Treble Boost'
  | 'Electronic'
  | 'Rock'
  | 'Pop'
  | 'Custom';

// 5-band EQ frequencies in Hz
export const EQ_FREQUENCIES = [60, 250, 1000, 4000, 16000] as const;

export const EQ_PRESETS: Record<EQPresetName, [number, number, number, number, number]> = {
  Flat: [0, 0, 0, 0, 0],
  'Bass Boost': [5, 4, 1, 0, 0],
  Acoustic: [3, 2, 0, 2, 3],
  Vocal: [-1, 2, 5, 3, 0],
  'Treble Boost': [0, 0, 1, 4, 6],
  Electronic: [5, 3, -1, 2, 4],
  Rock: [4, 2, -1, 3, 5],
  Pop: [-1, 2, 4, 3, -1],
  Custom: [0, 0, 0, 0, 0],
};

export interface AudioSettingsState {
  // Crossfade (Sprint 4)
  crossfadeDuration: CrossfadeDuration;
  setCrossfadeDuration: (dur: CrossfadeDuration) => void;

  // Equalizer & Preamp (Sprint 5)
  eqEnabled: boolean;
  eqPreset: EQPresetName;
  eqBands: [number, number, number, number, number]; // in dB, clamped [-12, +12]
  preampGainDb: number; // clamped [-6, +6]
  setEqEnabled: (enabled: boolean) => void;
  setEqPreset: (preset: EQPresetName) => void;
  setEqBand: (index: 0 | 1 | 2 | 3 | 4, valueDb: number) => void;
  setPreampGainDb: (gainDb: number) => void;

  // Loudness Normalization (Sprint 5)
  normalizationEnabled: boolean;
  setNormalizationEnabled: (enabled: boolean) => void;
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

export const useAudioSettings = create<AudioSettingsState>()(
  persist(
    (set) => ({
      crossfadeDuration: 3,
      setCrossfadeDuration: (dur) => set({ crossfadeDuration: dur }),

      eqEnabled: false,
      eqPreset: 'Flat',
      eqBands: [0, 0, 0, 0, 0],
      preampGainDb: 0,
      setEqEnabled: (enabled) => set({ eqEnabled: enabled }),
      setEqPreset: (preset) =>
        set({
          eqPreset: preset,
          eqBands: [...EQ_PRESETS[preset]],
        }),
      setEqBand: (index, valueDb) =>
        set((state) => {
          const clamped = Math.max(-12, Math.min(12, valueDb));
          const next = [...state.eqBands] as [number, number, number, number, number];
          next[index] = clamped;
          return {
            eqBands: next,
            eqPreset: 'Custom',
          };
        }),
      setPreampGainDb: (gainDb) =>
        set({
          preampGainDb: Math.max(-6, Math.min(6, gainDb)),
        }),

      normalizationEnabled: true,
      setNormalizationEnabled: (enabled) => set({ normalizationEnabled: enabled }),
    }),
    {
      name: 'sway-audio-settings-v1',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
    }
  )
);
