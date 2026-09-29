'use client';

import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sliders,
  RotateCcw,
  Sparkles,
  Volume2,
  Radio,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import {
  useAudioSettings,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  type EQPresetName,
} from '@/store/useAudioSettings';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { SpectrumVisualizer } from './SpectrumVisualizer';

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`;
  return `${hz}`;
}

function getSpatialWidthLabel(width: number): string {
  if (width === 0) return 'Mono (Centered)';
  if (width < 100) return `Narrowed (${width}%)`;
  if (width === 100) return 'Standard Stereo';
  if (width <= 150) return `Spatial Wide (${width}%)`;
  return `Cinematic 3D (${width}%)`;
}

export function EqualizerModal() {
  const isOpen = useAudioSettings((s) => s.isEqualizerModalOpen);
  const close = useAudioSettings((s) => s.setEqualizerModalOpen);

  const eqEnabled = useAudioSettings((s) => s.eqEnabled);
  const setEqEnabled = useAudioSettings((s) => s.setEqEnabled);
  const eqPreset = useAudioSettings((s) => s.eqPreset);
  const setEqPreset = useAudioSettings((s) => s.setEqPreset);
  const eqBands = useAudioSettings((s) => s.eqBands);
  const setEqBand = useAudioSettings((s) => s.setEqBand);
  const preampGainDb = useAudioSettings((s) => s.preampGainDb);
  const setPreampGainDb = useAudioSettings((s) => s.setPreampGainDb);
  const resetEq = useAudioSettings((s) => s.resetEq);

  const bassBoost = useAudioSettings((s) => s.bassBoost);
  const setBassBoost = useAudioSettings((s) => s.setBassBoost);

  const spatialAudioEnabled = useAudioSettings((s) => s.spatialAudioEnabled);
  const spatialWidth = useAudioSettings((s) => s.spatialWidth);
  const setSpatialAudioEnabled = useAudioSettings((s) => s.setSpatialAudioEnabled);
  const setSpatialWidth = useAudioSettings((s) => s.setSpatialWidth);

  const normalizationEnabled = useAudioSettings((s) => s.normalizationEnabled);
  const setNormalizationEnabled = useAudioSettings((s) => s.setNormalizationEnabled);

  // Close on Escape & resume AudioContext if suspended
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        close(false);
      }
    },
    [isOpen, close]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleInteraction = () => {
    if (audioEngine) {
      audioEngine.resumeContext().catch(() => {});
    }
  };

  const presetList = Object.keys(EQ_PRESETS) as EQPresetName[];

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="eq-modal-title"
          onClick={handleInteraction}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close(false)}
            className="absolute inset-0 bg-black/75 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 15 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-neutral-900/95 border border-white/10 rounded-2xl shadow-2xl text-white flex flex-col p-5 sm:p-7 backdrop-blur-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-emerald-400">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id="eq-modal-title" className="text-lg font-bold tracking-tight">
                      Studio Equalizer & DSP
                    </h2>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        eqEnabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-white/5 border-white/10 text-neutral-400'
                      }`}
                    >
                      {eqEnabled ? 'Active' : 'Bypassed'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400">
                    10-band ISO graphic equalizer with real-time WebAudio filters
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Master EQ toggle */}
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={eqEnabled}
                    onChange={(e) => setEqEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
                </label>

                {/* Close Button */}
                <button
                  onClick={() => close(false)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close equalizer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Spectrum Visualizer */}
            <div className="my-4 p-3 rounded-xl bg-black/40 border border-white/5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 font-mono uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  Real-time FFT Frequency Spectrum
                </span>
                <span>60 FPS Hardware Accelerated</span>
              </div>
              <SpectrumVisualizer height={80} barCount={40} className="rounded-lg" />
            </div>

            {/* Presets & Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-300">Preset:</span>
                <select
                  value={eqPreset}
                  disabled={!eqEnabled}
                  onChange={(e) => setEqPreset(e.target.value as EQPresetName)}
                  className="bg-neutral-800 border border-white/10 text-white text-xs font-medium rounded-lg px-3 py-1.5 outline-none focus:border-emerald-500 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {presetList.map((preset) => (
                    <option key={preset} value={preset} className="bg-neutral-900 text-white">
                      {preset}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={resetEq}
                  disabled={!eqEnabled}
                  className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5 transition-colors disabled:opacity-30"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to Flat
                </button>
              </div>
            </div>

            {/* 10-Band Sliders Grid */}
            <div
              className={`p-4 rounded-xl bg-black/20 border border-white/5 transition-opacity ${
                eqEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 mb-2 px-1">
                <span>+12 dB</span>
                <span>0 dB (Flat)</span>
                <span>-12 dB</span>
              </div>

              {/* 10 vertical sliders */}
              <div className="grid grid-cols-10 gap-1 sm:gap-2 h-44 sm:h-48 items-center">
                {EQ_FREQUENCIES.map((freq, idx) => {
                  const val = eqBands[idx] ?? 0;
                  return (
                    <div key={freq} className="flex flex-col items-center h-full justify-between">
                      {/* dB value */}
                      <span className="text-[10px] font-mono text-neutral-300 tabular-nums">
                        {val > 0 ? `+${val}` : val}
                      </span>

                      {/* Slider Track */}
                      <div className="relative flex-1 w-full flex items-center justify-center my-1.5">
                        {/* 0dB Center Guideline */}
                        <div className="absolute w-full h-[1px] bg-white/15 pointer-events-none" />

                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={val}
                          onChange={(e) => setEqBand(idx, parseInt(e.target.value, 10))}
                          onDoubleClick={() => setEqBand(idx, 0)}
                          className="h-full w-2.5 appearance-none bg-neutral-800 rounded-full cursor-pointer accent-emerald-400 [writing-mode:vertical-lr] [direction:rtl]"
                          title={`${formatFreq(freq)}Hz: ${val} dB (Double click to reset)`}
                        />
                      </div>

                      {/* Frequency label */}
                      <span
                        className="text-[10px] font-mono font-semibold text-neutral-400 mt-1 cursor-pointer hover:text-white"
                        onDoubleClick={() => setEqBand(idx, 0)}
                        title="Double-click to reset band"
                      >
                        {formatFreq(freq)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* DSP Enhancement Suite */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-5">
              {/* Bass Boost Resonator */}
              <div className="p-3.5 rounded-xl bg-black/25 border border-white/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-white">Bass Boost Resonator</span>
                  </div>
                  <span className="text-xs font-mono font-medium text-amber-400">
                    {bassBoost}%
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 mb-3">
                  80Hz low-shelf resonant sub-bass enhancement with harmonic warmth
                </p>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={bassBoost}
                  disabled={!eqEnabled}
                  onChange={(e) => setBassBoost(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg cursor-pointer accent-amber-400 disabled:opacity-40"
                />
              </div>

              {/* Preamp Gain */}
              <div className="p-3.5 rounded-xl bg-black/25 border border-white/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-white">Preamp Gain</span>
                  </div>
                  <span className="text-xs font-mono font-medium text-cyan-400">
                    {preampGainDb > 0 ? `+${preampGainDb}` : preampGainDb} dB
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 mb-3">
                  Analog head-room gain staging before EQ processing (-6 to +6 dB)
                </p>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={preampGainDb}
                  disabled={!eqEnabled}
                  onChange={(e) => setPreampGainDb(parseFloat(e.target.value))}
                  onDoubleClick={() => setPreampGainDb(0)}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg cursor-pointer accent-cyan-400 disabled:opacity-40"
                />
              </div>

              {/* 3D Spatial Audio & Stereo Widener */}
              <div className="p-3.5 rounded-xl bg-black/25 border border-white/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-semibold text-white">3D Spatial Widener</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={spatialAudioEnabled}
                      onChange={(e) => setSpatialAudioEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500" />
                  </label>
                </div>
                <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-2">
                  <span>{getSpatialWidthLabel(spatialWidth)}</span>
                  <span className="font-mono text-purple-400">{spatialWidth}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={spatialWidth}
                  disabled={!spatialAudioEnabled}
                  onChange={(e) => setSpatialWidth(parseInt(e.target.value, 10))}
                  onDoubleClick={() => setSpatialWidth(100)}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg cursor-pointer accent-purple-400 disabled:opacity-40"
                />
              </div>

              {/* Loudness Normalization & Limiter */}
              <div className="p-3.5 rounded-xl bg-black/25 border border-white/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold text-white">Anti-Clip & Normalizer</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={normalizationEnabled}
                      onChange={(e) => setNormalizationEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500" />
                  </label>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Dynamics compressor with automatic gain levelling and zero-distortion brickwall peak limiter
                </p>
                <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 mt-2">
                  <span>Target: -14 LUFS</span>
                  <span>Limiter: -0.5 dBFS</span>
                </div>
              </div>
            </div>

            {/* Footer tips */}
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-400">
              <span>Tip: Double-click any slider to reset it to 0 dB / Default</span>
              <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-white/10 font-mono text-neutral-400">
                ESC to close
              </kbd>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
