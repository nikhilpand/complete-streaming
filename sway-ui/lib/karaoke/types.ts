/**
 * Karaoke system types.
 */

export type KaraokeStatus = 'not_prepared' | 'queued' | 'processing' | 'ready' | 'failed' | 'unavailable';

export type KaraokeMode = 'original' | 'karaoke' | 'sing';

export interface KaraokeInfo {
  track_id: string;
  status: KaraokeStatus;
  progress: number;
  ready: boolean;
  model_used?: string;
  error?: string;
}

export interface KaraokeState {
  /** Current karaoke mode. */
  mode: KaraokeMode;
  /** Status of the karaoke preparation job. */
  status: KaraokeStatus;
  /** Preparation progress 0.0–1.0. */
  progress: number;
  /** Whether stems are ready to use. */
  ready: boolean;
  /** Vocal volume when in 'sing' mode (0.0–1.0). */
  vocalVolume: number;
  /** Error message if status === 'failed'. */
  error?: string;
  /** The track ID this state is for. */
  trackId: string | null;
}
