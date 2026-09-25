/**
 * TypeScript Type Definitions for @levelup/lyrics-engine
 */

export interface LyricWord {
  text: string;
  startTime: number; // in milliseconds
  endTime: number;   // in milliseconds
}

export interface LyricLine {
  time: number;      // start time in milliseconds
  endTime: number;   // end time in milliseconds
  text: string;
  words: LyricWord[] | null;
}

export interface ParsedLyrics {
  lines: LyricLine[];
  isSynced: boolean;
  hasSyllables: boolean;
  provider: string;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // in seconds or milliseconds
  albumArt?: string;
  uri?: string;
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
}

export interface UseLyricsOptions {
  track: TrackMetadata | null;
  currentTimeMs: number;
  isPlaying?: boolean;
}

export interface UseLyricsReturn {
  lyrics: ParsedLyrics | null;
  activeLine: LyricLine | null;
  activeIndex: number;
  isLoading: boolean;
  error: Error | null;
  provider: string;
  offsetMs: number;
  setOffsetMs: (offset: number) => void;
}

export interface LyricsStageProps {
  track: TrackMetadata | null;
  currentTimeMs?: number;
  isPlaying?: boolean;
  onSeek?: (seekTimeMs: number) => void;
  className?: string;
  style?: any;
  showHud?: boolean;
}

export declare function LyricsStage(props: LyricsStageProps): any;
export declare function useLyrics(options: UseLyricsOptions): UseLyricsReturn;
export declare class ColorExtractor {
  static extractPalette(imageSource: string | HTMLImageElement): Promise<ColorPalette>;
}
export declare class AmbientBackground {
  constructor(containerElement: HTMLElement);
  setPalette(palette: ColorPalette): void;
  start(): void;
  stop(): void;
}
