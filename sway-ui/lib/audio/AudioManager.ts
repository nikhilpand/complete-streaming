/**
 * AudioManager — Facade over AudioEngine (Unified Dual-Pipeline Audio Architecture).
 *
 * All playback operations route through AudioEngine, ensuring persistent AudioContext,
 * dual-pipeline (A/B) gapless playback, WebAudio DSP graph (EQ, compressor, preamp),
 * and synchronized state management.
 */
import { AudioEngine, audioEngine, type AudioEngineEvent } from './AudioEngine';

export type AudioEvent = AudioEngineEvent;

export class AudioManager extends AudioEngine {}

export const audioManager = audioEngine || new AudioEngine();
