import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsFontSize = 'sm' | 'md' | 'lg' | 'xl';
export type LyricsLineHeight = 'compact' | 'normal' | 'relaxed';
export type LyricsFontFamily = 'noto' | 'mukta' | 'system';
export type LyricsContrast = 'high' | 'medium' | 'subtle';
export type LyricsBlur = 'off' | 'light' | 'strong';
export type LyricsAlign = 'left' | 'center';

export interface LyricsSettingsState {
  fontSize: LyricsFontSize;
  lineHeight: LyricsLineHeight;
  fontFamily: LyricsFontFamily;
  contrast: LyricsContrast;
  blur: LyricsBlur;
  align: LyricsAlign;
  showAccentBar: boolean;
  showRomanized: boolean;
  perTrackSyncOffset: Record<string, number>; // trackId -> offset in ms

  setFontSize: (fontSize: LyricsFontSize) => void;
  setLineHeight: (lineHeight: LyricsLineHeight) => void;
  setFontFamily: (fontFamily: LyricsFontFamily) => void;
  setContrast: (contrast: LyricsContrast) => void;
  setBlur: (blur: LyricsBlur) => void;
  setAlign: (align: LyricsAlign) => void;
  setShowAccentBar: (showAccentBar: boolean) => void;
  setShowRomanized: (showRomanized: boolean) => void;
  setTrackSyncOffset: (trackId: string, offsetMs: number) => void;
  getTrackSyncOffset: (trackId?: string) => number;
  applyPreset: (preset: 'minimal' | 'cinematic' | 'bold' | 'dense') => void;
  resetDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  fontSize: 'lg' as LyricsFontSize,
  lineHeight: 'normal' as LyricsLineHeight,
  fontFamily: 'noto' as LyricsFontFamily,
  contrast: 'medium' as LyricsContrast,
  blur: 'light' as LyricsBlur,
  align: 'left' as LyricsAlign,
  showAccentBar: true,
  showRomanized: false,
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

      setTrackSyncOffset: (trackId, offsetMs) =>
        set((state) => ({
          perTrackSyncOffset: {
            ...state.perTrackSyncOffset,
            [trackId]: offsetMs,
          },
        })),

      getTrackSyncOffset: (trackId) => {
        if (!trackId) return 0;
        return get().perTrackSyncOffset[trackId] || 0;
      },

      applyPreset: (preset) => {
        switch (preset) {
          case 'minimal':
            set({
              fontSize: 'md',
              lineHeight: 'normal',
              fontFamily: 'noto',
              contrast: 'medium',
              blur: 'off',
              align: 'left',
              showAccentBar: false,
            });
            break;
          case 'cinematic':
            set({
              fontSize: 'lg',
              lineHeight: 'relaxed',
              fontFamily: 'mukta',
              contrast: 'high',
              blur: 'strong',
              align: 'left',
              showAccentBar: true,
            });
            break;
          case 'bold':
            set({
              fontSize: 'xl',
              lineHeight: 'normal',
              fontFamily: 'noto',
              contrast: 'high',
              blur: 'light',
              align: 'left',
              showAccentBar: true,
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
            });
            break;
        }
      },

      resetDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'sway-lyrics-settings',
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
          },
        }),
      }).catch(() => {});
    }, 600);
  });
}

export function getLyricsCSSVars(settings: LyricsSettingsState) {
  // Font Size
  let fontSizeVal = 'clamp(1.6rem, 2.6vw, 2.6rem)';
  if (settings.fontSize === 'sm') fontSizeVal = 'clamp(1.2rem, 1.8vw, 1.8rem)';
  else if (settings.fontSize === 'md') fontSizeVal = 'clamp(1.4rem, 2.2vw, 2.2rem)';
  else if (settings.fontSize === 'xl') fontSizeVal = 'clamp(1.9rem, 3.2vw, 3.2rem)';

  // Line Height
  let lineHeightVal = '1.45';
  if (settings.lineHeight === 'compact') lineHeightVal = '1.25';
  else if (settings.lineHeight === 'relaxed') lineHeightVal = '1.75';

  // Font Family
  let fontFamilyVal = 'var(--font-noto-devanagari), system-ui, sans-serif';
  if (settings.fontFamily === 'mukta') {
    fontFamilyVal = 'var(--font-mukta), system-ui, sans-serif';
  } else if (settings.fontFamily === 'system') {
    fontFamilyVal = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }

  // Contrast (inactive opacity)
  let inactiveOpacity = '0.28';
  if (settings.contrast === 'high') inactiveOpacity = '0.18';
  else if (settings.contrast === 'subtle') inactiveOpacity = '0.42';

  // Blur
  let blurVal = '1.2px';
  if (settings.blur === 'off') blurVal = '0px';
  else if (settings.blur === 'strong') blurVal = '2.5px';

  const textAlign = settings.align || 'left';
  const justifyContent = textAlign === 'center' ? 'center' : 'flex-start';
  const transformOrigin = textAlign === 'center' ? 'center center' : 'left center';

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
  } as React.CSSProperties;
}
