/**
 * KaraokeEngine — Web Audio API vocal/instrumental mixing.
 *
 * Architecture:
 *   HTMLAudioElement (audioManager) → MediaElementSource → [instrumentalGain, vocalGain]
 *   → Destination
 *
 * When mode is 'karaoke': vocalGain = 0, instrumentalGain = 1
 * When mode is 'sing':    vocalGain = vocalVolume, instrumentalGain = 1
 * When mode is 'original': vocalGain = 1, instrumentalGain = 1 (passthrough)
 *
 * IMPORTANT: In 'original' mode the main audio plays normally. In 'karaoke'/'sing' modes
 * the main audio is muted and two separate Audio elements play the stems.
 * The stems are synchronized to audioManager.currentTime on load.
 *
 * The engine manages:
 * 1. Two hidden Audio elements for stems (vocals.mp3, instrumental.mp3)
 * 2. Web Audio API graph routed from those elements
 * 3. Gain nodes for independent volume control
 * 4. Sync logic to keep stems aligned with the main audioManager timeline
 */

import { audioManager } from '@/lib/audio/AudioManager';
import type { KaraokeMode } from './types';

type StemAudioNode = {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

class KaraokeEngineImpl {
  private ctx: AudioContext | null = null;
  private vocalsNode: StemAudioNode | null = null;
  private instrumentalNode: StemAudioNode | null = null;
  private mode: KaraokeMode = 'original';
  private vocalVolume = 1.0;
  private activeTrackId: string | null = null;
  private initialized = false;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new window.AudioContext();
    }
    return this.ctx;
  }

  private createStemNode(url: string, ctx: AudioContext): StemAudioNode {
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    return { audio, source, gain };
  }

  private destroyNodes(): void {
    if (this.vocalsNode) {
      this.vocalsNode.audio.pause();
      this.vocalsNode.audio.src = '';
      this.vocalsNode.gain.disconnect();
      this.vocalsNode = null;
    }
    if (this.instrumentalNode) {
      this.instrumentalNode.audio.pause();
      this.instrumentalNode.audio.src = '';
      this.instrumentalNode.gain.disconnect();
      this.instrumentalNode = null;
    }
  }

  /**
   * Load stem audio files for a track and prepare the Web Audio graph.
   * Does NOT start playback — call syncToMainPlayer() after.
   */
  async loadStems(trackId: string, vocalsUrl: string, instrumentalUrl: string): Promise<void> {
    if (typeof window === 'undefined') return;
    this.destroyNodes();
    const ctx = this.getCtx();
    this.vocalsNode = this.createStemNode(vocalsUrl, ctx);
    this.instrumentalNode = this.createStemNode(instrumentalUrl, ctx);
    this.activeTrackId = trackId;
    this.initialized = true;
    this.applyGains();
  }

  /**
   * Sync stem playback position to the main player's currentTime.
   * Call when stems first load or when user seeks.
   */
  syncToMainPlayer(): void {
    if (!this.initialized || this.mode === 'original') return;
    const t = audioManager?.currentTime ?? 0;
    if (this.vocalsNode) this.vocalsNode.audio.currentTime = t;
    if (this.instrumentalNode) this.instrumentalNode.audio.currentTime = t;
  }

  /**
   * Set the karaoke mode and update audio graph accordingly.
   */
  setMode(mode: KaraokeMode): void {
    this.mode = mode;
    this.applyGains();
    this.applyMuteMainAudio();
    if (mode !== 'original' && this.initialized) {
      this.syncToMainPlayer();
      if (audioManager && !audioManager.paused) {
        this.play();
      }
    } else if (mode === 'original') {
      this.pause();
    }
  }

  syncIfDrifted(mainTime: number): void {
    if (!this.initialized || this.mode === 'original') return;
    if (this.instrumentalNode) {
      const diff = Math.abs(this.instrumentalNode.audio.currentTime - mainTime);
      if (diff > 0.35) {
        this.instrumentalNode.audio.currentTime = mainTime;
        if (this.vocalsNode) this.vocalsNode.audio.currentTime = mainTime;
      }
    }
  }

  /**
   * Set vocal volume for 'sing' mode (0.0 = muted, 1.0 = full).
   */
  setVocalVolume(v: number): void {
    this.vocalVolume = Math.max(0, Math.min(1, v));
    if (this.mode === 'sing') {
      this.applyGains();
    }
  }

  private applyGains(): void {
    if (!this.vocalsNode || !this.instrumentalNode) return;
    switch (this.mode) {
      case 'original':
        this.vocalsNode.gain.gain.value = 0;       // stems are not playing in original mode
        this.instrumentalNode.gain.gain.value = 0;
        break;
      case 'karaoke':
        this.vocalsNode.gain.gain.value = 0;       // vocals muted
        this.instrumentalNode.gain.gain.value = 1; // full instrumental
        break;
      case 'sing':
        this.vocalsNode.gain.gain.value = this.vocalVolume;
        this.instrumentalNode.gain.gain.value = 1; // full instrumental
        break;
    }
  }

  private applyMuteMainAudio(): void {
    // In karaoke/sing mode, mute the original audio track
    // so only stems play through the Web Audio graph
    const el = audioManager?.audioElement;
    if (!el) return;
    if (this.mode === 'original') {
      el.muted = false; // restore original
    } else if (this.initialized) {
      el.muted = true; // stems take over
    }
  }

  /**
   * Start stem playback (called when main player starts playing).
   */
  play(): void {
    if (!this.initialized || this.mode === 'original') return;
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    this.syncToMainPlayer();
    this.vocalsNode?.audio.play().catch(() => {});
    this.instrumentalNode?.audio.play().catch(() => {});
  }

  /**
   * Pause stem playback.
   */
  pause(): void {
    this.vocalsNode?.audio.pause();
    this.instrumentalNode?.audio.pause();
  }

  /**
   * Seek all stems to a new time position.
   */
  seek(time: number): void {
    if (!this.initialized || this.mode === 'original') return;
    if (this.vocalsNode) this.vocalsNode.audio.currentTime = time;
    if (this.instrumentalNode) this.instrumentalNode.audio.currentTime = time;
  }

  /**
   * Deactivate karaoke — restore original audio, destroy stems.
   */
  deactivate(): void {
    this.mode = 'original';
    const el = audioManager?.audioElement;
    if (el) el.muted = false;
    this.destroyNodes();
    this.initialized = false;
    this.activeTrackId = null;
  }

  get isActive(): boolean {
    return this.initialized && this.mode !== 'original';
  }

  get currentMode(): KaraokeMode {
    return this.mode;
  }
}

export const karaokeEngine =
  typeof window !== 'undefined' ? new KaraokeEngineImpl() : null as unknown as KaraokeEngineImpl;
