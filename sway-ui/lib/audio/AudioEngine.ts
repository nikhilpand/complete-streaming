import { getSavedVolume, getSavedMuted } from '@/lib/utils';
import { useAudioSettings, EQ_FREQUENCIES } from '@/store/useAudioSettings';

export type AudioEngineEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'loading' }
  | { type: 'canplay' }
  | { type: 'timeupdate'; currentTime: number; duration: number }
  | { type: 'progress'; bufferedTime: number }
  | { type: 'error'; message: string }
  | { type: 'volumechange'; volume: number; muted: boolean }
  | { type: 'transition_start'; fromTrackId?: string; toTrackId?: string }
  | { type: 'transition_end'; trackId?: string };

type Listener = (event: AudioEngineEvent) => void;

interface AudioPipeline {
  id: 'A' | 'B';
  audio: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
  trackId: string | null;
  isLoaded: boolean;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private pipelines: [AudioPipeline, AudioPipeline] | null = null;
  private activePipelineIndex = 0; // 0 = A, 1 = B
  private masterGainNode: GainNode | null = null;
  private preampGainNode: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  private listeners = new Set<Listener>();
  private rafId: number | null = null;
  private isTransitioning = false;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  private userVolume = getSavedVolume(0.8);
  private userMuted = getSavedMuted(false);

  constructor() {
    // Lazy initialization on first play or explicit init()
  }

  /**
   * Initializes persistent AudioContext and dual pipelines.
   * Safe to call multiple times (idempotent).
   */
  public init(): AudioPipeline {
    if (this.pipelines) {
      return this.pipelines[this.activePipelineIndex];
    }

    if (typeof window === 'undefined') {
      // Mock pipelines for SSR / Node environment
      const createMockAudio = () =>
        ({
          volume: this.userVolume,
          muted: this.userMuted,
          currentTime: 0,
          duration: 0,
          paused: true,
          ended: false,
          src: '',
          buffered: { length: 0, start: () => 0, end: () => 0 } as unknown as TimeRanges,
          play: async () => {},
          pause: () => {},
          load: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        } as unknown as HTMLAudioElement);

      this.pipelines = [
        { id: 'A', audio: createMockAudio(), sourceNode: null, gainNode: null, trackId: null, isLoaded: false },
        { id: 'B', audio: createMockAudio(), sourceNode: null, gainNode: null, trackId: null, isLoaded: false },
      ];
      return this.pipelines[this.activePipelineIndex];
    }

    // 1. One persistent AudioContext
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      this.audioContext = new AudioCtx();
    }

    // 2. Build DSP graph:
    // [pipelineA.gain, pipelineB.gain] -> preamp -> 5 EQ filters -> compressor -> masterGain -> analyser -> destination
    if (this.audioContext) {
      const ctx = this.audioContext;

      this.masterGainNode = ctx.createGain();
      this.masterGainNode.gain.setValueAtTime(this.userMuted ? 0 : this.userVolume, ctx.currentTime);

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.preampGainNode = ctx.createGain();
      this.preampGainNode.gain.setValueAtTime(1.0, ctx.currentTime);

      // Compressor to prevent distortion/clipping
      this.compressorNode = ctx.createDynamicsCompressor();
      this.compressorNode.threshold.setValueAtTime(-1.0, ctx.currentTime);
      this.compressorNode.knee.setValueAtTime(6.0, ctx.currentTime);
      this.compressorNode.ratio.setValueAtTime(8.0, ctx.currentTime);
      this.compressorNode.attack.setValueAtTime(0.005, ctx.currentTime);
      this.compressorNode.release.setValueAtTime(0.05, ctx.currentTime);

      // 5-band EQ filters
      this.eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        filter.frequency.setValueAtTime(freq, ctx.currentTime);
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.setValueAtTime(1.4, ctx.currentTime);
        }
        filter.gain.setValueAtTime(0, ctx.currentTime);
        return filter;
      });

      // Connect DSP chain
      let prevNode: AudioNode = this.preampGainNode;
      for (const filter of this.eqFilters) {
        prevNode.connect(filter);
        prevNode = filter;
      }
      prevNode.connect(this.compressorNode);
      this.compressorNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);

      // Apply initial settings
      this.syncAudioSettings();
    }

    // 3. Create Pipelines A & B
    const createPipeline = (id: 'A' | 'B'): AudioPipeline => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';

      let sourceNode: MediaElementAudioSourceNode | null = null;
      let gainNode: GainNode | null = null;

      if (this.audioContext && this.preampGainNode) {
        try {
          sourceNode = this.audioContext.createMediaElementSource(audio);
          gainNode = this.audioContext.createGain();
          gainNode.gain.setValueAtTime(id === 'A' ? 1.0 : 0.0, this.audioContext.currentTime);
          sourceNode.connect(gainNode);
          gainNode.connect(this.preampGainNode);
        } catch {
          // Fallback to direct element volume if WebAudio connection is restricted
        }
      }

      this.wirePipelineEvents(audio, id);

      return {
        id,
        audio,
        sourceNode,
        gainNode,
        trackId: null,
        isLoaded: false,
      };
    };

    const pipeA = createPipeline('A');
    const pipeB = createPipeline('B');
    this.pipelines = [pipeA, pipeB];
    this.activePipelineIndex = 0;

    return this.pipelines[0];
  }

  private wirePipelineEvents(audio: HTMLAudioElement, pipeId: 'A' | 'B') {
    audio.addEventListener('play', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'play' });
        this.startRaf();
      }
    });

    audio.addEventListener('playing', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'play' });
        this.startRaf();
      }
    });

    audio.addEventListener('pause', () => {
      if (this.isCurrentPipeline(pipeId) && !this.isTransitioning) {
        this.emit({ type: 'pause' });
        this.stopRaf();
      }
    });

    audio.addEventListener('ended', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'ended' });
        this.stopRaf();
      }
    });

    audio.addEventListener('waiting', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'loading' });
      }
    });

    audio.addEventListener('canplay', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'canplay' });
      }
    });

    audio.addEventListener('progress', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'progress', bufferedTime: this.bufferedTime });
      }
    });

    audio.addEventListener('error', () => {
      if (this.isCurrentPipeline(pipeId)) {
        const code = audio.error?.code;
        const messages: Record<number, string> = {
          1: 'Playback aborted',
          2: 'Network error during playback',
          3: 'Audio decode error',
          4: 'Format not supported',
        };
        const msg = messages[code ?? 0] ?? (audio.error?.message || 'Playback failed');
        this.emit({ type: 'error', message: msg });
        this.stopRaf();
      }
    });
  }

  private isCurrentPipeline(id: 'A' | 'B'): boolean {
    if (!this.pipelines) return id === 'A';
    return this.pipelines[this.activePipelineIndex].id === id;
  }

  public get activePipeline(): AudioPipeline {
    this.init();
    return this.pipelines![this.activePipelineIndex];
  }

  public get standbyPipeline(): AudioPipeline {
    this.init();
    return this.pipelines![1 - this.activePipelineIndex];
  }

  public get activeAudio(): HTMLAudioElement {
    return this.activePipeline.audio;
  }

  public get standbyAudio(): HTMLAudioElement {
    return this.standbyPipeline.audio;
  }

  // ── Sync Settings with Audio Nodes (Sprint 5) ──
  public syncAudioSettings() {
    if (!this.audioContext) return;
    const ctx = this.audioContext;
    const settings = useAudioSettings.getState();

    // 1. Preamp gain
    if (this.preampGainNode) {
      const preampLinear = Math.pow(10, (settings.preampGainDb || 0) / 20);
      this.preampGainNode.gain.setTargetAtTime(preampLinear, ctx.currentTime, 0.05);
    }

    // 2. 5-Band EQ filters
    if (this.eqFilters.length === 5) {
      const enabled = settings.eqEnabled;
      this.eqFilters.forEach((filter, idx) => {
        const targetGainDb = enabled ? settings.eqBands[idx] || 0 : 0;
        filter.gain.setTargetAtTime(targetGainDb, ctx.currentTime, 0.05);
      });
    }
  }

  // ── Playback Controls ──
  public async load(url: string, trackId?: string): Promise<void> {
    const pipeline = this.activePipeline;
    pipeline.trackId = trackId || null;
    if (pipeline.audio.src !== url) {
      pipeline.audio.src = url;
      pipeline.isLoaded = true;
    }
  }

  /**
   * Preload upcoming track into the StandbyPipeline for near-gapless/crossfade transition.
   */
  public preload(url: string, trackId?: string) {
    const standby = this.standbyPipeline;
    standby.trackId = trackId || null;
    if (standby.audio.src !== url) {
      standby.audio.src = url;
      standby.audio.load();
      standby.isLoaded = true;
      if (standby.gainNode && this.audioContext) {
        standby.gainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);
      }
    }
  }

  public async play(): Promise<void> {
    const pipeline = this.activePipeline;
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {}
    }

    try {
      await pipeline.audio.play();
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

  public pause() {
    this.cancelTransition();
    this.activeAudio.pause();
    this.stopRaf();
  }

  public seek(time: number) {
    this.cancelTransition();
    if (this.activeAudio) {
      this.activeAudio.currentTime = time;
    }
  }

  public setVolume(v: number) {
    const safe = Math.max(0, Math.min(1, v));
    this.userVolume = safe;

    if (this.masterGainNode && this.audioContext) {
      const targetGain = this.userMuted ? 0 : safe;
      this.masterGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.02);
    } else {
      if (this.pipelines) {
        this.pipelines[0].audio.volume = safe;
        this.pipelines[1].audio.volume = safe;
      }
    }
    this.emit({ type: 'volumechange', volume: safe, muted: this.userMuted });
  }

  public setMuted(m: boolean) {
    this.userMuted = m;

    if (this.masterGainNode && this.audioContext) {
      const targetGain = m ? 0 : this.userVolume;
      this.masterGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.02);
    } else {
      if (this.pipelines) {
        this.pipelines[0].audio.muted = m;
        this.pipelines[1].audio.muted = m;
      }
    }
    this.emit({ type: 'volumechange', volume: this.userVolume, muted: m });
  }

  // ── Sprint 4: Crossfade & Seamless Pipeline Swap ──
  public async crossfadeToStandby(durationSec?: number): Promise<void> {
    if (!this.pipelines || this.isTransitioning) return;

    const crossfadeDur =
      durationSec !== undefined
        ? durationSec
        : useAudioSettings.getState().crossfadeDuration;

    const active = this.activePipeline;
    const standby = this.standbyPipeline;

    if (!standby.isLoaded || !standby.audio.src) {
      // Standby not preloaded, standard ended trigger
      this.emit({ type: 'ended' });
      return;
    }

    if (crossfadeDur <= 0 || !this.audioContext || !active.gainNode || !standby.gainNode) {
      // Gapless transition: instant swap (0 delay)
      this.isTransitioning = true;
      try {
        await standby.audio.play();
      } catch {}
      active.audio.pause();
      active.audio.currentTime = 0;
      this.activePipelineIndex = 1 - this.activePipelineIndex;
      this.isTransitioning = false;
      this.emit({ type: 'play' });
      return;
    }

    // Dual GainNode linear crossfade
    this.isTransitioning = true;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const fromTrack = active.trackId || undefined;
    const toTrack = standby.trackId || undefined;

    this.emit({ type: 'transition_start', fromTrackId: fromTrack, toTrackId: toTrack });

    // Ensure standby begins muted and starts playing
    standby.gainNode.gain.cancelScheduledValues(now);
    standby.gainNode.gain.setValueAtTime(0.0001, now);
    try {
      await standby.audio.play();
    } catch {}

    // Ramp active down and standby up
    active.gainNode.gain.cancelScheduledValues(now);
    active.gainNode.gain.setValueAtTime(active.gainNode.gain.value, now);
    active.gainNode.gain.linearRampToValueAtTime(0.0001, now + crossfadeDur);

    standby.gainNode.gain.linearRampToValueAtTime(1.0, now + crossfadeDur);

    this.transitionTimer = setTimeout(() => {
      active.audio.pause();
      active.audio.currentTime = 0;
      if (active.gainNode && this.audioContext) {
        active.gainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);
      }
      this.activePipelineIndex = 1 - this.activePipelineIndex;
      this.isTransitioning = false;
      this.transitionTimer = null;
      this.emit({ type: 'transition_end', trackId: toTrack });
    }, crossfadeDur * 1000);
  }

  public cancelTransition() {
    if (!this.isTransitioning) return;
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.audioContext && this.pipelines) {
      const now = this.audioContext.currentTime;
      const active = this.activePipeline;
      const standby = this.standbyPipeline;

      if (active.gainNode) {
        active.gainNode.gain.cancelScheduledValues(now);
        active.gainNode.gain.setValueAtTime(1.0, now);
      }
      if (standby.gainNode) {
        standby.gainNode.gain.cancelScheduledValues(now);
        standby.gainNode.gain.setValueAtTime(0.0, now);
      }
      standby.audio.pause();
    }
    this.isTransitioning = false;
  }

  // ── RAF Tick Loop ──
  private startRaf() {
    if (this.rafId !== null) return;
    const tick = () => {
      const a = this.activeAudio;
      if (a && !a.paused && !a.ended) {
        const cur = a.currentTime;
        const dur = a.duration || 0;
        this.emit({ type: 'timeupdate', currentTime: cur, duration: dur });

        // Check if approaching track end for crossfade (only if track is long enough)
        const crossfadeSec = useAudioSettings.getState().crossfadeDuration;
        if (
          crossfadeSec > 0 &&
          dur > crossfadeSec * 2 &&
          cur >= dur - crossfadeSec &&
          !this.isTransitioning &&
          this.standbyPipeline.isLoaded
        ) {
          this.crossfadeToStandby(crossfadeSec);
        }

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

  // ── Subscriptions ──
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: AudioEngineEvent) {
    this.listeners.forEach((cb) => cb(event));
  }

  // ── Visualizer / Spectrum API (Sprint 5) ──
  public getFrequencyData(outputArray: Uint8Array): void {
    if (this.analyserNode) {
      this.analyserNode.getByteFrequencyData(outputArray as any);
    }
  }

  public getWaveformData(outputArray: Uint8Array): void {
    if (this.analyserNode) {
      this.analyserNode.getByteTimeDomainData(outputArray as any);
    }
  }

  // ── State Getters ──
  get currentTime() {
    return this.activeAudio?.currentTime ?? 0;
  }
  get duration() {
    return this.activeAudio?.duration ?? 0;
  }
  get volume() {
    return this.userVolume;
  }
  get muted() {
    return this.userMuted;
  }
  get paused() {
    return this.activeAudio?.paused ?? true;
  }
  get bufferedTime(): number {
    const a = this.activeAudio;
    if (!a || a.buffered.length === 0) return 0;
    return a.buffered.end(a.buffered.length - 1);
  }
  get audioElement(): HTMLAudioElement | null {
    return this.activeAudio;
  }
  get context(): AudioContext | null {
    return this.audioContext;
  }
}

export const audioEngine =
  typeof window !== 'undefined' ? new AudioEngine() : (null as unknown as AudioEngine);
