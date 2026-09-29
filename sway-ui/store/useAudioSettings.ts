import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CrossfadeDuration = 0 | 1 | 3 | 5 | 8 | 12;

export type EQPresetName =
  | 'Flat'
  | 'Bass Boost'
  | 'Bass Reducer'
  | 'Treble Boost'
  | 'Treble Reducer'
  | 'Vocal'
  | 'Acoustic'
  | 'Classical'
  | 'Club'
  | 'Dance'
  | 'Deep'
  | 'Electronic'
  | 'Hip-Hop'
  | 'Jazz'
  | 'Latin'
  | 'Loudness'
  | 'Lounge'
  | 'Piano'
  | 'Pop'
  | 'R&B'
  | 'Rock'
  | 'Custom';

// 10-band ISO standard octave frequencies in Hz
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export type EQBands10 = [number, number, number, number, number, number, number, number, number, number];

export const EQ_PRESETS: Record<EQPresetName, EQBands10> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [6, 5, 4, 2, 1, 0, 0, 0, 0, 0],
  'Bass Reducer': [-6, -5, -4, -2, -1, 0, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Treble Reducer': [0, 0, 0, 0, 0, -1, -2, -4, -5, -6],
  Vocal: [-2, -1, 1, 3, 5, 4, 3, 2, 0, -1],
  Acoustic: [3, 3, 2, 1, 0, 1, 2, 3, 3, 2],
  Classical: [4, 3, 2, 2, -1, -1, 0, 2, 3, 4],
  Club: [0, 0, 2, 4, 4, 4, 2, 0, 0, 0],
  Dance: [6, 5, 2, 0, 0, 2, 4, 4, 3, 0],
  Deep: [5, 4, 3, 1, 0, -1, -1, -2, -2, -3],
  Electronic: [5, 4, 2, 0, -1, 2, 1, 3, 4, 5],
  'Hip-Hop': [6, 5, 3, 1, -1, -1, 1, -1, 2, 3],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  Latin: [3, 2, 0, 0, -1, -1, -1, 1, 3, 4],
  Loudness: [6, 4, 0, -1, -2, -1, 0, 3, 5, 6],
  Lounge: [-2, -1, 0, 2, 4, 3, 1, 0, 2, 1],
  Piano: [2, 1, 0, 2, 3, 1, 2, 3, 2, 2],
  Pop: [-1, 1, 3, 4, 4, 2, 0, 1, 2, -1],
  'R&B': [4, 6, 4, 1, -2, -1, 2, 3, 3, 4],
  Rock: [5, 3, -1, -2, 1, 2, 3, 4, 4, 5],
  Custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export interface AudioSettingsState {
  // Crossfade & Gapless
  crossfadeDuration: CrossfadeDuration;
  setCrossfadeDuration: (dur: CrossfadeDuration) => void;

  // 10-Band Pro Equalizer & Preamp
  eqEnabled: boolean;
  eqPreset: EQPresetName;
  eqBands: EQBands10; // in dB, clamped [-12, +12]
  preampGainDb: number; // clamped [-6, +6]
  setEqEnabled: (enabled: boolean) => void;
  setEqPreset: (preset: EQPresetName) => void;
  setEqBand: (index: number, valueDb: number) => void;
  setPreampGainDb: (gainDb: number) => void;
  resetEq: () => void;

  // Bass Boost Resonator (0 - 100%)
  bassBoost: number;
  setBassBoost: (val: number) => void;

  // 3D Spatial Audio & Stereo Widener
  spatialAudioEnabled: boolean;
  spatialWidth: number; // 0 (mono) .. 100 (normal) .. 200 (ultra-wide)
  setSpatialAudioEnabled: (enabled: boolean) => void;
  setSpatialWidth: (width: number) => void;

  // Loudness Normalization & Anti-Clipping Limiter
  normalizationEnabled: boolean;
  setNormalizationEnabled: (enabled: boolean) => void;

  // UI Modal state
  isEqualizerModalOpen: boolean;
  toggleEqualizerModal: () => void;
  setEqualizerModalOpen: (open: boolean) => void;
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
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preampGainDb: 0,
      setEqEnabled: (enabled) => set({ eqEnabled: enabled }),
      setEqPreset: (preset) =>
        set({
          eqPreset: preset,
          eqBands: [...EQ_PRESETS[preset]],
        }),
      setEqBand: (index, valueDb) =>
        set((state) => {
          if (index < 0 || index >= 10) return {};
          const clamped = Math.max(-12, Math.min(12, valueDb));
          const next = [...state.eqBands] as EQBands10;
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
      resetEq: () =>
        set({
          eqPreset: 'Flat',
          eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          preampGainDb: 0,
          bassBoost: 0,
        }),

      bassBoost: 0,
      setBassBoost: (val) => set({ bassBoost: Math.max(0, Math.min(100, Math.round(val))) }),

      spatialAudioEnabled: false,
      spatialWidth: 100,
      setSpatialAudioEnabled: (enabled) => set({ spatialAudioEnabled: enabled }),
      setSpatialWidth: (width) => set({ spatialWidth: Math.max(0, Math.min(200, Math.round(width))) }),

      normalizationEnabled: true,
      setNormalizationEnabled: (enabled) => set({ normalizationEnabled: enabled }),

      isEqualizerModalOpen: false,
      toggleEqualizerModal: () => set((s) => ({ isEqualizerModalOpen: !s.isEqualizerModalOpen })),
      setEqualizerModalOpen: (open) => set({ isEqualizerModalOpen: open }),
    }),
    {
      name: 'sway-audio-settings-v2',
      storage: createJSONStorage(() => safeStorage),
      version: 2,
      migrate: (persistedState: any) => {
        if (!persistedState) return persistedState;
        // Migrate 5-band array to 10-band array if needed
        if (Array.isArray(persistedState.eqBands) && persistedState.eqBands.length === 5) {
          const old = persistedState.eqBands;
          persistedState.eqBands = [old[0], old[0], old[1], old[1], old[2], old[2], old[3], old[3], old[4], old[4]];
        }
        return persistedState;
      },
    }
  )
);
