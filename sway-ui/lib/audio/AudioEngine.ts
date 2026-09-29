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

class SsrTimeRanges implements TimeRanges {
  constructor(private ranges: Array<{ start: number; end: number }> = [{ start: 0, end: 180 }]) {}
  get length() { return this.ranges.length; }
  start(index: number) { return this.ranges[index]?.start ?? 0; }
  end(index: number) { return this.ranges[index]?.end ?? 0; }
}

class SsrAudioElement extends EventTarget implements Partial<HTMLAudioElement> {
  public src = '';
  public preload: '' | 'none' | 'auto' | 'metadata' = 'auto';
  public volume = 0.8;
  public muted = false;
  public currentTime = 0;
  public duration = 180;
  public paused = true;
  public ended = false;
  public readyState = 4; // HAVE_ENOUGH_DATA
  public buffered: TimeRanges = new SsrTimeRanges();
  public error: MediaError | null = null;
  public crossOrigin: string | null = 'anonymous';

  public async play(): Promise<void> {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    setTimeout(() => {
      if (!this.paused) {
        this.dispatchEvent(new Event('playing'));
      }
    }, 0);
  }

  public pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }

  public load(): void {
    this.dispatchEvent(new Event('canplay'));
  }
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private pipelines: [AudioPipeline, AudioPipeline] | null = null;
  private activePipelineIndex = 0; // 0 = A, 1 = B
  private masterGainNode: GainNode | null = null;
  private preampGainNode: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassBoostFilter: BiquadFilterNode | null = null;
  private spatialSplitter: ChannelSplitterNode | null = null;
  private spatialMerger: ChannelMergerNode | null = null;
  private spatialGainLL: GainNode | null = null;
  private spatialGainRL: GainNode | null = null;
  private spatialGainLR: GainNode | null = null;
  private spatialGainRR: GainNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private settingsUnsub: (() => void) | null = null;

  private listeners = new Set<Listener>();
  private rafId: number | null = null;
  private isTransitioning = false;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionGeneration = 0;
  public transitionConfirmTimeoutMs = 1200;
  private repeatMode: 'none' | 'one' | 'all' = 'none';

  private userVolume = getSavedVolume(0.8);
  private userMuted = getSavedMuted(false);

  constructor() {
    // Lazy initialization on first play or explicit init()
  }

  /**
   * Initializes persistent AudioContext and dual pipelines.
   * Safe to call multiple times (idempotent).
   */
  public init(): HTMLAudioElement {
    if (this.pipelines) {
      return this.pipelines[this.activePipelineIndex].audio;
    }

    if (typeof window === 'undefined') {
      // Mock pipelines for SSR / Node environment
      const audioA = new SsrAudioElement() as unknown as HTMLAudioElement;
      const audioB = new SsrAudioElement() as unknown as HTMLAudioElement;
      audioA.volume = this.userVolume;
      audioB.volume = this.userVolume;
      audioA.muted = this.userMuted;
      audioB.muted = this.userMuted;

      this.wirePipelineEvents(audioA, 'A');
      this.wirePipelineEvents(audioB, 'B');

      this.pipelines = [
        { id: 'A', audio: audioA, sourceNode: null, gainNode: null, trackId: null, isLoaded: false },
        { id: 'B', audio: audioB, sourceNode: null, gainNode: null, trackId: null, isLoaded: false },
      ];

      if (!this.settingsUnsub) {
        this.settingsUnsub = useAudioSettings.subscribe(() => this.syncAudioSettings());
      }

      return this.pipelines[this.activePipelineIndex].audio;
    }

    // 1. One persistent AudioContext
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      this.audioContext = new AudioCtx();
    }

    // 2. Build DSP graph:
    // [pipelineA.gain, pipelineB.gain] -> preamp -> 10 EQ filters -> bassBoost -> spatializer -> compressor -> masterGain -> analyser -> destination
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

      // 10-band ISO standard EQ filters
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

      // Bass Boost low-shelf filter (80 Hz)
      this.bassBoostFilter = ctx.createBiquadFilter();
      this.bassBoostFilter.type = 'lowshelf';
      this.bassBoostFilter.frequency.setValueAtTime(80, ctx.currentTime);
      this.bassBoostFilter.gain.setValueAtTime(0, ctx.currentTime);

      // 3D Spatial Audio & Stereo Widener (Mid-Side matrix processor)
      this.spatialSplitter = ctx.createChannelSplitter(2);
      this.spatialMerger = ctx.createChannelMerger(2);
      this.spatialGainLL = ctx.createGain();
      this.spatialGainRL = ctx.createGain();
      this.spatialGainLR = ctx.createGain();
      this.spatialGainRR = ctx.createGain();

      this.spatialGainLL.gain.setValueAtTime(1.0, ctx.currentTime);
      this.spatialGainRL.gain.setValueAtTime(0.0, ctx.currentTime);
      this.spatialGainLR.gain.setValueAtTime(0.0, ctx.currentTime);
      this.spatialGainRR.gain.setValueAtTime(1.0, ctx.currentTime);

      this.spatialSplitter.connect(this.spatialGainLL, 0);
      this.spatialSplitter.connect(this.spatialGainLR, 0);
      this.spatialSplitter.connect(this.spatialGainRL, 1);
      this.spatialSplitter.connect(this.spatialGainRR, 1);

      this.spatialGainLL.connect(this.spatialMerger, 0, 0);
      this.spatialGainRL.connect(this.spatialMerger, 0, 0);
      this.spatialGainLR.connect(this.spatialMerger, 0, 1);
      this.spatialGainRR.connect(this.spatialMerger, 0, 1);

      // Connect DSP chain
      let prevNode: AudioNode = this.preampGainNode;
      for (const filter of this.eqFilters) {
        prevNode.connect(filter);
        prevNode = filter;
      }
      prevNode.connect(this.bassBoostFilter);
      this.bassBoostFilter.connect(this.spatialSplitter);
      this.spatialMerger.connect(this.compressorNode);
      this.compressorNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);

      // Reactively sync whenever useAudioSettings changes (sliders, presets, toggles)
      if (!this.settingsUnsub) {
        this.settingsUnsub = useAudioSettings.subscribe(() => this.syncAudioSettings());
      }

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

    return this.pipelines[0].audio;
  }

  private wirePipelineEvents(audio: HTMLAudioElement, pipeId: 'A' | 'B') {
    audio.addEventListener('play', () => {
      if (this.isCurrentPipeline(pipeId) && !this.isTransitioning) {
        this.emit({ type: 'play' });
        this.startRaf();
      }
    });

    audio.addEventListener('playing', () => {
      if (this.isCurrentPipeline(pipeId) && !this.isTransitioning) {
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
      if (!this.isCurrentPipeline(pipeId)) return;

      // Invariant: If a transition (crossfade or gapless confirm) is actively underway,
      // the outgoing pipeline reaching its natural end must NOT clear standby or emit ended.
      // The ongoing transition timer / playing callback will finalize the pipeline swap.
      if (this.isTransitioning) {
        return;
      }

      // Invariant: If repeatMode is 'one', never automatic transition to standby
      if (this.repeatMode === 'one') {
        this.clearStandby();
        this.emit({ type: 'ended' });
        this.stopRaf();
        return;
      }

      const standby = this.standbyPipeline;
      if (this.hasUsableBuffer(standby, 0.5)) {
        this.executeGaplessTransition(standby);
        return;
      }

      // Standby not usable -> clean fallback to ended
      this.clearStandby();
      this.emit({ type: 'ended' });
      this.stopRaf();
    });

    audio.addEventListener('volumechange', () => {
      if (this.isCurrentPipeline(pipeId)) {
        this.emit({ type: 'volumechange', volume: audio.volume, muted: audio.muted });
      }
    });

    audio.addEventListener('waiting', () => {
      if (this.isCurrentPipeline(pipeId) && !this.isTransitioning) {
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
      if (this.isCurrentPipeline(pipeId) && !this.isTransitioning) {
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
    const now = ctx.currentTime;
    const settings = useAudioSettings.getState();

    // 1. Preamp gain (-6dB to +6dB)
    if (this.preampGainNode) {
      const preampLinear = Math.pow(10, (settings.preampGainDb || 0) / 20);
      this.preampGainNode.gain.setTargetAtTime(preampLinear, now, 0.03);
    }

    // 2. 10-Band EQ filters
    if (this.eqFilters.length === EQ_FREQUENCIES.length) {
      const enabled = settings.eqEnabled;
      this.eqFilters.forEach((filter, idx) => {
        const targetGainDb = enabled ? (settings.eqBands[idx] ?? 0) : 0;
        filter.gain.setTargetAtTime(targetGainDb, now, 0.03);
      });
    }

    // 3. Bass Boost Resonator (0 - 100% -> 0 to 10 dB low-shelf at 80Hz)
    if (this.bassBoostFilter) {
      const boostGainDb = settings.eqEnabled ? ((settings.bassBoost || 0) / 100) * 10 : 0;
      this.bassBoostFilter.gain.setTargetAtTime(boostGainDb, now, 0.03);
    }

    // 4. 3D Spatial Audio & Stereo Widener (Mid-Side matrix processor)
    if (
      this.spatialGainLL &&
      this.spatialGainRL &&
      this.spatialGainLR &&
      this.spatialGainRR
    ) {
      // widthFactor: 1.0 = normal, 0.0 = mono, 2.0 = ultra-wide 3D
      const widthFactor = settings.spatialAudioEnabled
        ? Math.max(0, Math.min(2, (settings.spatialWidth ?? 100) / 100))
        : 1.0;

      const gainDirectRaw = 0.5 * (1 + widthFactor);
      const gainCrossRaw = 0.5 * (1 - widthFactor);
      // Pan-law energy normalization: prevents runaway gain and phase clipping at wider widths
      const normFactor = 1 / Math.max(1, Math.sqrt(gainDirectRaw * gainDirectRaw + gainCrossRaw * gainCrossRaw));
      const gainDirect = gainDirectRaw * normFactor;
      const gainCross = gainCrossRaw * normFactor;

      this.spatialGainLL.gain.setTargetAtTime(gainDirect, now, 0.03);
      this.spatialGainRL.gain.setTargetAtTime(gainCross, now, 0.03);
      this.spatialGainLR.gain.setTargetAtTime(gainCross, now, 0.03);
      this.spatialGainRR.gain.setTargetAtTime(gainDirect, now, 0.03);
    }

    // 5. Anti-Clipping Limiter & Loudness Normalization
    if (this.compressorNode) {
      if (settings.normalizationEnabled) {
        // Broadcast loudness normalization: preserves dynamics with gentle ratio & soft knee
        this.compressorNode.threshold.setTargetAtTime(-16.0, now, 0.03);
        this.compressorNode.ratio.setTargetAtTime(3.0, now, 0.03);
        this.compressorNode.knee.setTargetAtTime(12.0, now, 0.03);
        this.compressorNode.attack.setTargetAtTime(0.015, now, 0.03);
        this.compressorNode.release.setTargetAtTime(0.25, now, 0.03);
      } else {
        // Transparent peak limiter: high ceiling (-0.2 dBFS), fast recovery, zero pump
        this.compressorNode.threshold.setTargetAtTime(-0.2, now, 0.03);
        this.compressorNode.ratio.setTargetAtTime(20.0, now, 0.03);
        this.compressorNode.knee.setTargetAtTime(1.0, now, 0.03);
        this.compressorNode.attack.setTargetAtTime(0.003, now, 0.03);
        this.compressorNode.release.setTargetAtTime(0.12, now, 0.03);
      }
    }
  }

  public async resumeContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {}
    }
  }

  private normalizeUrl(url: string): string {
    if (typeof window !== 'undefined' && url) {
      if ((url.includes('googlevideo.com') || url.includes('youtube.com')) && !url.includes('/api/proxy/stream')) {
        return `/api/proxy/stream?url=${encodeURIComponent(url)}`;
      }
    }
    return url;
  }

  // ── Playback Controls ──
  public async load(url: string, trackId?: string): Promise<void> {
    const pipeline = this.activePipeline;
    pipeline.trackId = trackId || null;
    const safeUrl = this.normalizeUrl(url);
    if (pipeline.audio.src !== safeUrl) {
      pipeline.audio.src = safeUrl;
      if (typeof pipeline.audio.load === 'function') {
        pipeline.audio.load(); // explicitly start fetching
      }
      pipeline.isLoaded = true;
    }
  }

  /**
   * Preload upcoming track into the StandbyPipeline for near-gapless/crossfade transition.
   */
  public preload(url: string, trackId?: string) {
    const standby = this.standbyPipeline;
    standby.trackId = trackId || null;
    const safeUrl = this.normalizeUrl(url);
    if (standby.audio.src !== safeUrl) {
      standby.audio.src = safeUrl;
      if (typeof standby.audio.load === 'function') {
        standby.audio.load();
      }
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
    }
    if (this.pipelines) {
      this.pipelines[0].audio.volume = safe;
      this.pipelines[1].audio.volume = safe;
    }
    this.emit({ type: 'volumechange', volume: safe, muted: this.userMuted });
  }

  public setMuted(m: boolean) {
    this.userMuted = m;

    if (this.masterGainNode && this.audioContext) {
      const targetGain = m ? 0 : this.userVolume;
      this.masterGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.02);
    }
    if (this.pipelines) {
      this.pipelines[0].audio.muted = m;
      this.pipelines[1].audio.muted = m;
    }
    this.emit({ type: 'volumechange', volume: this.userVolume, muted: m });
  }

  // ── Standby & Transition Management ──
  public setRepeatMode(mode: 'none' | 'one' | 'all'): void {
    this.repeatMode = mode;
  }

  public getRepeatMode(): 'none' | 'one' | 'all' {
    return this.repeatMode;
  }

  public hasUsableBuffer(pipeline: AudioPipeline, requiredSeconds = 0.5): boolean {
    if (!pipeline.isLoaded || !pipeline.audio.src) return false;
    const a = pipeline.audio;
    const readyState = typeof a.readyState === 'number' ? a.readyState : 4;
    // Condition 1: readyState must be at least HAVE_FUTURE_DATA (3)
    if (readyState < 3) return false;

    // Condition 2: bufferedAhead must meet required threshold
    const cur = a.currentTime || 0;
    let maxEnd = 0;
    try {
      if (a.buffered && a.buffered.length > 0) {
        for (let i = 0; i < a.buffered.length; i++) {
          if (a.buffered.start(i) <= cur + 0.1 && a.buffered.end(i) > maxEnd) {
            maxEnd = a.buffered.end(i);
          }
        }
      }
    } catch {}

    const bufferedAhead = Math.max(0, maxEnd - cur);
    if (a.buffered && a.buffered.length > 0) {
      return bufferedAhead >= requiredSeconds;
    }
    // If buffered property is defined but has 0 ranges, buffer is not usable
    if (a.buffered && a.buffered.length === 0) {
      return false;
    }
    // Fallback only if buffered API is completely unavailable (e.g. non-browser/mock environment)
    return readyState >= 4;
  }

  public clearStandby(): void {
    if (!this.pipelines) return;
    const standby = this.pipelines[1 - this.activePipelineIndex];
    standby.audio.pause();
    standby.audio.currentTime = 0;
    standby.trackId = null;
    standby.isLoaded = false;
    standby.audio.src = '';
    if (standby.gainNode && this.audioContext) {
      standby.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
      standby.gainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);
    }
  }

  private executeGaplessTransition(standby: AudioPipeline): void {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    const gen = ++this.transitionGeneration;
    const active = this.activePipeline;
    const fromTrack = active.trackId || undefined;
    const toTrack = standby.trackId || undefined;
    const activeIndex = this.activePipelineIndex;
    const standbyIndex = 1 - this.activePipelineIndex;

    this.emit({ type: 'transition_start', fromTrackId: fromTrack, toTrackId: toTrack });

    let resolved = false;

    const cleanup = () => {
      resolved = true;
      if (this.transitionWatchdogTimer !== null) {
        clearTimeout(this.transitionWatchdogTimer);
        this.transitionWatchdogTimer = null;
      }
      standby.audio.removeEventListener('playing', onPlaying);
      standby.audio.removeEventListener('error', onError);
    };

    const onPlaying = () => {
      if (resolved || gen !== this.transitionGeneration) return;
      cleanup();

      // Atomic swap upon confirmed playback!
      this.activePipelineIndex = standbyIndex;
      const oldPipeline = this.pipelines![activeIndex];
      oldPipeline.audio.pause();
      oldPipeline.audio.currentTime = 0;
      oldPipeline.trackId = null;
      oldPipeline.isLoaded = false;
      oldPipeline.audio.src = '';

      if (this.audioContext) {
        const now = this.audioContext.currentTime;
        if (oldPipeline.gainNode) {
          oldPipeline.gainNode.gain.cancelScheduledValues(now);
          oldPipeline.gainNode.gain.setValueAtTime(0.0, now);
        }
        if (this.activePipeline.gainNode) {
          this.activePipeline.gainNode.gain.cancelScheduledValues(now);
          this.activePipeline.gainNode.gain.setValueAtTime(1.0, now);
        }
      }

      this.isTransitioning = false;
      this.emit({ type: 'transition_end', trackId: toTrack });
      this.startRaf();
    };

    const onError = (err?: any) => {
      if (resolved || gen !== this.transitionGeneration) return;
      cleanup();
      // Standby failed to start -> clean fallback to standard ended path
      this.clearStandby();
      this.isTransitioning = false;
      this.emit({ type: 'ended' });
      this.stopRaf();
    };

    standby.audio.addEventListener('playing', onPlaying, { once: true });
    standby.audio.addEventListener('error', onError, { once: true });

    this.transitionWatchdogTimer = setTimeout(() => {
      if (resolved || gen !== this.transitionGeneration) return;
      onError(new Error('Standby transition watchdog expired'));
    }, this.transitionConfirmTimeoutMs);

    standby.audio.play().catch((err: unknown) => {
      const e = err as Error;
      if (e?.name === 'NotAllowedError') {
        if (resolved || gen !== this.transitionGeneration) return;
        cleanup();
        this.clearStandby();
        this.isTransitioning = false;
        this.emit({ type: 'pause' });
        this.stopRaf();
        return;
      }
      onError(err);
    });
  }

  // ── Sprint 4: Crossfade & Seamless Pipeline Swap ──
  public async crossfadeToStandby(durationSec?: number): Promise<void> {
    if (!this.pipelines || this.isTransitioning) return;
    if (this.repeatMode === 'one') return;

    const crossfadeDur =
      durationSec !== undefined
        ? durationSec
        : useAudioSettings.getState().crossfadeDuration;

    const active = this.activePipeline;
    const standby = this.standbyPipeline;

    // Invariant: Verify standby has usable buffer ahead (crossfade duration + safety margin)
    if (!this.hasUsableBuffer(standby, crossfadeDur + 0.5)) {
      return;
    }

    if (crossfadeDur <= 0 || !this.audioContext || !active.gainNode || !standby.gainNode) {
      // Gapless transition
      this.executeGaplessTransition(standby);
      return;
    }

    // Dual GainNode linear crossfade
    this.isTransitioning = true;
    const gen = ++this.transitionGeneration;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const fromTrack = active.trackId || undefined;
    const toTrack = standby.trackId || undefined;
    const activeIndex = this.activePipelineIndex;
    const standbyIndex = 1 - this.activePipelineIndex;

    this.emit({ type: 'transition_start', fromTrackId: fromTrack, toTrackId: toTrack });

    // Ensure standby starts playing with 0 initial gain
    standby.gainNode.gain.cancelScheduledValues(now);
    standby.gainNode.gain.setValueAtTime(0.0001, now);

    let resolved = false;

    const cleanup = () => {
      resolved = true;
      if (this.transitionWatchdogTimer !== null) {
        clearTimeout(this.transitionWatchdogTimer);
        this.transitionWatchdogTimer = null;
      }
      standby.audio.removeEventListener('playing', onPlaying);
      standby.audio.removeEventListener('error', onError);
    };

    const onError = () => {
      if (resolved || gen !== this.transitionGeneration) return;
      cleanup();
      this.cancelTransition();
      this.clearStandby();
      this.isTransitioning = false;
      this.emit({ type: 'ended' });
      this.stopRaf();
    };

    const onPlaying = () => {
      if (resolved || gen !== this.transitionGeneration) return;
      cleanup();

      const tNow = ctx.currentTime;
      active.gainNode!.gain.cancelScheduledValues(tNow);
      active.gainNode!.gain.setValueAtTime(active.gainNode!.gain.value, tNow);
      active.gainNode!.gain.linearRampToValueAtTime(0.0001, tNow + crossfadeDur);

      standby.gainNode!.gain.cancelScheduledValues(tNow);
      standby.gainNode!.gain.setValueAtTime(0.0001, tNow);
      standby.gainNode!.gain.linearRampToValueAtTime(1.0, tNow + crossfadeDur);

      this.transitionTimer = setTimeout(() => {
        if (gen !== this.transitionGeneration) return;
        active.audio.pause();
        active.audio.currentTime = 0;
        active.trackId = null;
        active.isLoaded = false;
        active.audio.src = '';
        if (active.gainNode && this.audioContext) {
          active.gainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);
        }
        this.activePipelineIndex = standbyIndex;
        this.isTransitioning = false;
        this.transitionTimer = null;
        this.emit({ type: 'transition_end', trackId: toTrack });
        this.startRaf();
      }, crossfadeDur * 1000);
    };

    standby.audio.addEventListener('playing', onPlaying, { once: true });
    standby.audio.addEventListener('error', onError, { once: true });

    this.transitionWatchdogTimer = setTimeout(() => {
      if (resolved || gen !== this.transitionGeneration) return;
      onError();
    }, this.transitionConfirmTimeoutMs);

    standby.audio.play().catch(() => {
      onError();
    });
  }

  public cancelTransition(options: { clearStandby?: boolean } = { clearStandby: true }) {
    this.transitionGeneration++; // Invalidate any pending async transition callbacks
    if (this.transitionWatchdogTimer !== null) {
      clearTimeout(this.transitionWatchdogTimer);
      this.transitionWatchdogTimer = null;
    }
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
    if (options.clearStandby) {
      this.clearStandby();
    }
    this.isTransitioning = false;
  }

  // ── RAF Tick Loop ──
  private startRaf() {
    if (typeof requestAnimationFrame === 'undefined') return;
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
    if (typeof cancelAnimationFrame === 'undefined') return;
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
    if (!this.pipelines) return 0;
    return this.activeAudio?.currentTime ?? 0;
  }
  get duration() {
    if (!this.pipelines) return 0;
    return this.activeAudio?.duration ?? 0;
  }
  get volume() {
    return this.userVolume;
  }
  get muted() {
    return this.userMuted;
  }
  get paused() {
    if (!this.pipelines) return true;
    return this.activeAudio?.paused ?? true;
  }
  get bufferedTime(): number {
    if (!this.pipelines) return 0;
    const a = this.activeAudio;
    if (!a || a.buffered.length === 0) return 0;
    return a.buffered.end(a.buffered.length - 1);
  }
  get audioElement(): HTMLAudioElement | null {
    return this.pipelines ? this.activeAudio : null;
  }
  get context(): AudioContext | null {
    return this.audioContext;
  }
  get transitioning(): boolean {
    return this.isTransitioning;
  }
  get generation(): number {
    return this.transitionGeneration;
  }
}

export const audioEngine =
  typeof window !== 'undefined' ? new AudioEngine() : (null as unknown as AudioEngine);
