import { getSavedVolume, getSavedMuted } from '@/lib/utils';

type Listener = (event: AudioEvent) => void;

export type AudioEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'loading' }
  | { type: 'canplay' }
  | { type: 'timeupdate'; currentTime: number; duration: number }
  | { type: 'progress'; bufferedTime: number }
  | { type: 'error'; message: string }
  | { type: 'volumechange'; volume: number; muted: boolean };

export class AudioManager {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private rafId: number | null = null;

  public init(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    a.volume = getSavedVolume(0.8);
    a.muted = getSavedMuted(false);

    a.addEventListener('play', () => {
      this.emit({ type: 'play' });
      this.startRaf();
    });
    a.addEventListener('playing', () => {
      this.emit({ type: 'play' });
      this.startRaf();
    });
    a.addEventListener('pause', () => {
      this.emit({ type: 'pause' });
      this.stopRaf();
    });
    a.addEventListener('ended', () => {
      this.emit({ type: 'ended' });
      this.stopRaf();
    });
    a.addEventListener('waiting', () => this.emit({ type: 'loading' }));
    a.addEventListener('canplay', () => this.emit({ type: 'canplay' }));
    a.addEventListener('progress', () => {
      this.emit({ type: 'progress', bufferedTime: this.bufferedTime });
    });
    a.addEventListener('volumechange', () =>
      this.emit({ type: 'volumechange', volume: a.volume, muted: a.muted })
    );
    a.addEventListener('error', () => {
      const code = a.error?.code;
      const messages: Record<number, string> = {
        1: 'Playback aborted',
        2: 'Network error during playback',
        3: 'Audio decode error',
        4: 'Format not supported',
      };
      const msg = messages[code ?? 0] ?? (a.error?.message || 'Playback failed');
      this.emit({ type: 'error', message: msg });
      this.stopRaf();
    });

    this.audio = a;
    return a;
  }

  private startRaf() {
    if (this.rafId !== null) return;
    const tick = () => {
      const a = this.audio;
      if (a && !a.paused && !a.ended) {
        this.emit({ type: 'timeupdate', currentTime: a.currentTime, duration: a.duration || 0 });
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: AudioEvent) {
    this.listeners.forEach((cb) => cb(event));
  }

  async load(url: string): Promise<void> {
    const a = this.init();
    if (a.src !== url) {
      a.src = url;
    }
  }

  async play(): Promise<void> {
    const a = this.init();
    try {
      await a.play();
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'NotAllowedError') {
        console.warn('Playback blocked by browser autoplay policy:', e.message);
        this.emit({ type: 'pause' });
        throw err;
      }
      if (e.name === 'AbortError') {
        return;
      }
      throw err;
    }
  }

  pause() {
    this.audio?.pause();
    this.stopRaf();
  }

  seek(time: number) {
    if (this.audio) {
      this.audio.currentTime = time;
    }
  }

  setVolume(v: number) {
    if (this.audio) {
      this.audio.volume = Math.max(0, Math.min(1, v));
    }
  }

  setMuted(m: boolean) {
    if (this.audio) {
      this.audio.muted = m;
    }
  }

  get currentTime() { return this.audio?.currentTime ?? 0; }
  get duration() { return this.audio?.duration ?? 0; }
  get volume() { return this.audio?.volume ?? 0.8; }
  get muted() { return this.audio?.muted ?? false; }
  get paused() { return this.audio?.paused ?? true; }
  get bufferedTime(): number {
    if (!this.audio || this.audio.buffered.length === 0) return 0;
    return this.audio.buffered.end(this.audio.buffered.length - 1);
  }
  get audioElement(): HTMLAudioElement | null { return this.audio; }
}

export const audioManager = typeof window !== 'undefined' ? new AudioManager() : null as unknown as AudioManager;
