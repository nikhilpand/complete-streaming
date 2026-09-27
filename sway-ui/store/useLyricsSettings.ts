import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsFontSize = 'sm' | 'md' | 'lg' | 'xl';
export type LyricsLineHeight = 'compact' | 'normal' | 'relaxed';
export type LyricsFontFamily = 'noto' | 'mukta' | 'system';
export type LyricsContrast = 'high' | 'medium' | 'subtle';
export type LyricsBlur = 'off' | 'light' | 'strong';
export type LyricsAlign = 'left' | 'center';
export type LyricsLayoutMode = 'split' | 'focus' | 'column' | 'canvas';
export type LyricsBackgroundStyle = 'wash' | 'mesh' | 'slate' | 'oled';
export type LyricsKaraokeEffect = 'smooth_sweep' | 'glow' | 'bounce';
export type PlayerStageMode = 'apple' | 'vinyl' | 'cinema';

export interface LyricsSettingsState {
  fontSize: LyricsFontSize;
  lineHeight: LyricsLineHeight;
  fontFamily: LyricsFontFamily;
  contrast: LyricsContrast;
  blur: LyricsBlur;
  align: LyricsAlign;
  showAccentBar: boolean;
  showRomanized: boolean;
  layoutMode: LyricsLayoutMode;
  stageMode: PlayerStageMode;
  motionBackground: 'dynamic' | 'static';
  globalSyncOffsetMs: number;
  backgroundStyle: LyricsBackgroundStyle;
  showInstrumentalCountdown: boolean;
  karaokeEffect: LyricsKaraokeEffect;
  perTrackSyncOffset: Record<string, number>; // trackId -> offset in ms

  setFontSize: (fontSize: LyricsFontSize) => void;
  setLineHeight: (lineHeight: LyricsLineHeight) => void;
  setFontFamily: (fontFamily: LyricsFontFamily) => void;
  setContrast: (contrast: LyricsContrast) => void;
  setBlur: (blur: LyricsBlur) => void;
  setAlign: (align: LyricsAlign) => void;
  setShowAccentBar: (showAccentBar: boolean) => void;
  setShowRomanized: (showRomanized: boolean) => void;
  setLayoutMode: (mode: LyricsLayoutMode) => void;
  setStageMode: (mode: PlayerStageMode) => void;
  cycleStageMode: () => void;
  setMotionBackground: (motion: 'dynamic' | 'static') => void;
  setGlobalSyncOffsetMs: (offset: number) => void;
  setBackgroundStyle: (style: LyricsBackgroundStyle) => void;
  setShowInstrumentalCountdown: (show: boolean) => void;
  setKaraokeEffect: (effect: LyricsKaraokeEffect) => void;
  setTrackSyncOffset: (trackId: string, offsetMs: number) => void;
  getTrackSyncOffset: (trackId?: string) => number;
  applyPreset: (preset: 'minimal' | 'cinematic' | 'bold' | 'dense' | 'party') => void;
  resetDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  fontSize: 'lg' as LyricsFontSize,
  lineHeight: 'normal' as LyricsLineHeight,
  fontFamily: 'system' as LyricsFontFamily,
  contrast: 'medium' as LyricsContrast,
  blur: 'light' as LyricsBlur,
  align: 'left' as LyricsAlign,
  showAccentBar: false,
  showRomanized: false,
  layoutMode: 'split' as LyricsLayoutMode,
  stageMode: 'apple' as PlayerStageMode,
  motionBackground: 'dynamic' as 'dynamic' | 'static',
  globalSyncOffsetMs: 0,
  backgroundStyle: 'wash' as LyricsBackgroundStyle,
  showInstrumentalCountdown: true,
  karaokeEffect: 'smooth_sweep' as LyricsKaraokeEffect,
  perTrackSyncOffset: {} as Record<string, number>,
};

export const useLyricsSettings = create<LyricsSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setContrast: (contrast) => set({ contrast }),
      setBlur: (blur) => set({ blur }),
      setAlign: (align) => set({ align }),
      setShowAccentBar: (showAccentBar) => set({ showAccentBar }),
      setShowRomanized: (showRomanized) => set({ showRomanized }),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      setStageMode: (stageMode) => set({ stageMode }),
      cycleStageMode: () => {
        const current = get().stageMode;
        const next: PlayerStageMode = current === 'apple' ? 'vinyl' : current === 'vinyl' ? 'cinema' : 'apple';
        set({ stageMode: next });
      },
      setMotionBackground: (motionBackground) => set({ motionBackground }),
      setGlobalSyncOffsetMs: (globalSyncOffsetMs) => set({ globalSyncOffsetMs }),
      setBackgroundStyle: (backgroundStyle) => set({ backgroundStyle }),
      setShowInstrumentalCountdown: (showInstrumentalCountdown) => set({ showInstrumentalCountdown }),
      setKaraokeEffect: (karaokeEffect) => set({ karaokeEffect }),

      setTrackSyncOffset: (trackId, offsetMs) =>
        set((state) => ({
          perTrackSyncOffset: {
            ...state.perTrackSyncOffset,
            [trackId]: offsetMs,
          },
        })),

      getTrackSyncOffset: (trackId) => {
        if (!trackId) return get().globalSyncOffsetMs || 0;
        const trackVal = get().perTrackSyncOffset[trackId];
        return (trackVal !== undefined ? trackVal : 0) + (get().globalSyncOffsetMs || 0);
      },

      applyPreset: (preset) => {
        switch (preset) {
          case 'minimal':
            set({
              fontSize: 'md',
              lineHeight: 'normal',
              fontFamily: 'system',
              contrast: 'medium',
              blur: 'off',
              align: 'left',
              showAccentBar: false,
              layoutMode: 'column',
              stageMode: 'apple',
              backgroundStyle: 'oled',
              showInstrumentalCountdown: false,
              karaokeEffect: 'smooth_sweep',
            });
            break;
          case 'cinematic':
            set({
              fontSize: 'lg',
              lineHeight: 'relaxed',
              fontFamily: 'system',
              contrast: 'medium',
              blur: 'light',
              align: 'left',
              showAccentBar: false,
              layoutMode: 'split',
              stageMode: 'apple',
              backgroundStyle: 'wash',
              showInstrumentalCountdown: true,
              karaokeEffect: 'smooth_sweep',
            });
            break;
          case 'bold':
            set({
              fontSize: 'xl',
              lineHeight: 'normal',
              fontFamily: 'system',
              contrast: 'medium',
              blur: 'light',
              align: 'left',
              showAccentBar: false,
              layoutMode: 'split',
              stageMode: 'cinema',
              backgroundStyle: 'mesh',
              showInstrumentalCountdown: true,
              karaokeEffect: 'glow',
            });
            break;
          case 'dense':
            set({
              fontSize: 'sm',
              lineHeight: 'compact',
              fontFamily: 'system',
              contrast: 'medium',
              blur: 'off',
              align: 'left',
              showAccentBar: false,
              layoutMode: 'column',
              stageMode: 'apple',
              backgroundStyle: 'wash',
              showInstrumentalCountdown: false,
              karaokeEffect: 'smooth_sweep',
            });
            break;
          case 'party':
            set({
              fontSize: 'xl',
              lineHeight: 'relaxed',
              fontFamily: 'system',
              contrast: 'medium',
              blur: 'strong',
              align: 'left',
              showAccentBar: false,
              layoutMode: 'split',
              stageMode: 'cinema',
              backgroundStyle: 'mesh',
              showInstrumentalCountdown: true,
              karaokeEffect: 'bounce',
            });
            break;
        }
      },

      resetDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'sway-lyrics-settings',
      version: 3,
      migrate: (persistedState: any, version: number) => {
        const state = { ...DEFAULT_SETTINGS, ...(persistedState || {}) };
        if (version < 3) {
          state.stageMode = state.stageMode || 'apple';
          state.motionBackground = state.motionBackground || 'dynamic';
          state.globalSyncOffsetMs = state.globalSyncOffsetMs || 0;
          state.align = 'left';
          state.fontFamily = 'system';
        }
        return state;
      },
    }
  )
);

// Auto-sync lyrics preferences to backend
if (typeof window !== 'undefined') {
  let syncTimer: any = null;
  useLyricsSettings.subscribe((state) => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      fetch('/api/proxy/users/guest_user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            fontSize: state.fontSize,
            lineHeight: state.lineHeight,
            fontFamily: state.fontFamily,
            contrast: state.contrast,
            blur: state.blur,
            align: state.align,
            showAccentBar: state.showAccentBar,
            showRomanized: state.showRomanized,
            layoutMode: state.layoutMode,
            backgroundStyle: state.backgroundStyle,
            showInstrumentalCountdown: state.showInstrumentalCountdown,
            karaokeEffect: state.karaokeEffect,
          },
        }),
      }).catch(() => {});
    }, 600);
  });
}

export function getLyricsCSSVars(settings: LyricsSettingsState) {
  // Font Size
  let fontSizeVal = 'clamp(1.75rem, 2.7vw, 2.75rem)';
  if (settings.fontSize === 'sm') fontSizeVal = 'clamp(1.3rem, 1.9vw, 1.9rem)';
  else if (settings.fontSize === 'md') fontSizeVal = 'clamp(1.5rem, 2.3vw, 2.3rem)';
  else if (settings.fontSize === 'xl') fontSizeVal = 'clamp(2.0rem, 3.2vw, 3.2rem)';

  // Line Height
  let lineHeightVal = '1.38';
  if (settings.lineHeight === 'compact') lineHeightVal = '1.25';
  else if (settings.lineHeight === 'relaxed') lineHeightVal = '1.65';

  // Font Family
  let fontFamilyVal = 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", var(--font-noto-devanagari), system-ui, sans-serif';
  if (settings.fontFamily === 'mukta') {
    fontFamilyVal = 'var(--font-mukta), var(--font-geist-sans), -apple-system, sans-serif';
  } else if (settings.fontFamily === 'noto') {
    fontFamilyVal = 'var(--font-noto-devanagari), var(--font-geist-sans), -apple-system, sans-serif';
  }

  // Contrast (inactive opacity matching Apple Music)
  let inactiveOpacity = '0.42';
  if (settings.contrast === 'high') inactiveOpacity = '0.30';
  else if (settings.contrast === 'subtle') inactiveOpacity = '0.52';

  // Blur
  let blurVal = '1.2px';
  if (settings.blur === 'off') blurVal = '0px';
  else if (settings.blur === 'strong') blurVal = '2.2px';

  const textAlign = settings.align || 'left';
  const justifyContent = textAlign === 'center' ? 'center' : 'flex-start';
  const transformOrigin = textAlign === 'center' ? 'center center' : 'left center';

  // Background styling flags — Apple Music authentic luminous values
  let bgBrightness = '0.95';
  let bgOpacity = '1.0';
  if (settings.backgroundStyle === 'oled') {
    bgBrightness = '0';
    bgOpacity = '0';
    blurVal = '0px';
  } else if (settings.backgroundStyle === 'slate') {
    bgBrightness = '0.45';
    bgOpacity = '0.70';
    blurVal = '0.8px';
  } else if (settings.backgroundStyle === 'mesh') {
    bgBrightness = '1.0';
    bgOpacity = '1.0';
  }

  return {
    '--lyrics-font-size': fontSizeVal,
    '--blyrics-font-size': fontSizeVal,
    '--lyrics-line-height': lineHeightVal,
    '--blyrics-line-height': lineHeightVal,
    '--lyrics-font-family': fontFamilyVal,
    '--blyrics-font-family': fontFamilyVal,
    '--lyrics-inactive-opacity': inactiveOpacity,
    '--lyrics-blur-amount': blurVal,
    '--lyrics-text-align': textAlign,
    '--lyrics-justify-content': justifyContent,
    '--lyrics-transform-origin': transformOrigin,
    '--blyrics-background-brightness': bgBrightness,
    '--blyrics-background-opacity': bgOpacity,
    '--lyrics-layout-mode': settings.layoutMode,
    '--lyrics-stage-mode': settings.stageMode || 'apple',
    '--lyrics-motion-bg': settings.motionBackground || 'dynamic',
    '--lyrics-bg-style': settings.backgroundStyle,
    '--lyrics-karaoke-effect': settings.karaokeEffect,
  } as React.CSSProperties;
}
