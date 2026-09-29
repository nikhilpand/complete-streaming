'use client';

import React, { useState, useEffect } from 'react';
import {
  useAudioSettings,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  type CrossfadeDuration,
  type EQPresetName,
} from '@/store/useAudioSettings';
import { getCacheStats, clearAudioCache } from '@/lib/audioCache';
import { Sliders, Volume2, HardDrive, Trash2, Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const CROSSFADE_OPTIONS: { label: string; value: CrossfadeDuration }[] = [
  { label: 'Off (Gapless)', value: 0 },
  { label: '1s', value: 1 },
  { label: '3s (Default)', value: 3 },
  { label: '5s', value: 5 },
  { label: '8s', value: 8 },
  { label: '12s', value: 12 },
];

const PRESETS: EQPresetName[] = [
  'Flat',
  'Bass Boost',
  'Vocal',
  'Acoustic',
  'Electronic',
  'Rock',
  'Pop',
  'Club',
  'Hip-Hop',
  'Jazz',
  'Classical',
];

export function AudioSettingsSection() {
  const {
    crossfadeDuration,
    setCrossfadeDuration,
    eqEnabled,
    setEqEnabled,
    eqPreset,
    setEqPreset,
    eqBands,
    setEqBand,
    preampGainDb,
    setPreampGainDb,
    bassBoost,
    setBassBoost,
    spatialAudioEnabled,
    setSpatialAudioEnabled,
    spatialWidth,
    setSpatialWidth,
    normalizationEnabled,
    setNormalizationEnabled,
    toggleEqualizerModal,
  } = useAudioSettings();

  const [cacheStats, setCacheStats] = useState<{
    totalBytes: number;
    entryCount: number;
    maxBytes: number;
    usagePercent: number;
  }>({ totalBytes: 0, entryCount: 0, maxBytes: 250 * 1024 * 1024, usagePercent: 0 });
  const [clearing, setClearing] = useState(false);

  const loadStats = async () => {
    try {
      const s = await getCacheStats();
      setCacheStats(s);
    } catch {}
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearAudioCache();
      await loadStats();
    } finally {
      setClearing(false);
    }
  };

  const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  return (
    <div className="space-y-6 pt-4 border-t border-white/10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[--art-primary]" />
            Audio Engine & Playback
          </h2>
          <p className="text-xs text-white/50">Crossfade, 10-band ISO equalizer, 3D DSP, and offline cache</p>
        </div>
        <button
          type="button"
          onClick={toggleEqualizerModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5" />
          Open Studio EQ
        </button>
      </div>

      {/* 1. Crossfade & Gapless Playback */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-white/80">Crossfade Duration</label>
          <span className="text-xs font-mono text-[--art-primary]">
            {crossfadeDuration === 0 ? 'Gapless' : `${crossfadeDuration}s`}
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {CROSSFADE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCrossfadeDuration(opt.value)}
              className={cn(
                'px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all text-center border',
                crossfadeDuration === opt.value
                  ? 'bg-white text-black border-white shadow-sm'
                  : 'bg-white/[0.03] text-white/60 border-white/[0.06] hover:bg-white/10 hover:text-white'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 10-Band Equalizer & Preamp */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-medium text-white/80 block">10-Band Graphic Equalizer</label>
            <span className="text-[11px] text-white/50">ISO Standard Octave Biquad Filters with hardware acceleration</span>
          </div>
          <button
            type="button"
            onClick={() => setEqEnabled(!eqEnabled)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
              eqEnabled ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60 hover:text-white'
            )}
          >
            {eqEnabled ? 'Enabled' : 'Bypassed'}
          </button>
        </div>

        {/* Preset Pills */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setEqPreset(p)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border',
                eqPreset === p
                  ? 'bg-white/20 text-white border-white/30'
                  : 'bg-white/[0.02] text-white/50 border-white/[0.04] hover:bg-white/[0.06] hover:text-white'
              )}
            >
              {p}
            </button>
          ))}
          {eqPreset === 'Custom' && (
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Custom
            </span>
          )}
        </div>

        {/* Frequency Sliders (10-Band) */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 pt-2">
          {EQ_FREQUENCIES.map((freq, idx) => {
            const gain = eqBands[idx] || 0;
            const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            return (
              <div key={freq} className="flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-mono text-white/70">
                  {gain > 0 ? `+${gain}` : gain}dB
                </span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  disabled={!eqEnabled}
                  value={gain}
                  onChange={(e) => setEqBand(idx, Number(e.target.value))}
                  className={cn(
                    'w-full h-20 -rotate-180 appearance-none bg-white/10 rounded-full cursor-pointer accent-emerald-400',
                    !eqEnabled && 'opacity-40 cursor-not-allowed'
                  )}
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                  aria-label={`${label}Hz band gain`}
                />
                <span className="text-[10px] font-mono text-white/50">{label}</span>
              </div>
            );
          })}
        </div>

        {/* Preamp Gain */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
          <span className="text-white/60">Preamp Gain</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={-6}
              max={6}
              step={0.5}
              value={preampGainDb}
              disabled={!eqEnabled}
              onChange={(e) => setPreampGainDb(Number(e.target.value))}
              className="w-28 accent-emerald-400 cursor-pointer disabled:opacity-40"
              aria-label="Preamp Gain Slider"
            />
            <span className="font-mono text-white/80 w-10 text-right">
              {preampGainDb > 0 ? `+${preampGainDb}` : preampGainDb}dB
            </span>
          </div>
        </div>

        {/* Bass Boost Resonator */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
          <span className="text-white/60">Bass Boost Resonator</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={bassBoost}
              disabled={!eqEnabled}
              onChange={(e) => setBassBoost(Number(e.target.value))}
              className="w-28 accent-amber-400 cursor-pointer disabled:opacity-40"
              aria-label="Bass Boost Slider"
            />
            <span className="font-mono text-amber-400 w-10 text-right">
              {bassBoost}%
            </span>
          </div>
        </div>

        {/* 3D Spatial Audio & Stereo Widener */}
        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-white/60">3D Spatial Widener</span>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={spatialAudioEnabled}
                onChange={(e) => setSpatialAudioEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-7 h-3.5 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-purple-500" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={spatialWidth}
              disabled={!spatialAudioEnabled}
              onChange={(e) => setSpatialWidth(Number(e.target.value))}
              className="w-28 accent-purple-400 cursor-pointer disabled:opacity-40"
              aria-label="Spatial Width Slider"
            />
            <span className="font-mono text-purple-400 w-10 text-right">
              {spatialWidth}%
            </span>
          </div>
        </div>
      </div>

      {/* 3. Loudness Normalization */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div>
          <label className="text-xs font-medium text-white/80 block">Loudness Normalization</label>
          <span className="text-[11px] text-white/50">Equalize playback volume to standard -14 LUFS target</span>
        </div>
        <button
          type="button"
          onClick={() => setNormalizationEnabled(!normalizationEnabled)}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
            normalizationEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-white/10 text-white/50'
          )}
        >
          {normalizationEnabled ? 'Active (-14 LUFS)' : 'Disabled'}
        </button>
      </div>

      {/* 4. Offline Audio Cache (Sprint 6) */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-white/60" />
            <div>
              <label className="text-xs font-medium text-white/80 block">Offline Audio Cache</label>
              <span className="text-[11px] text-white/50">
                IndexedDB storage ({cacheStats.entryCount} tracks cached)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing || cacheStats.entryCount === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Cache
          </button>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, cacheStats.usagePercent)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/40 font-mono">
            <span>{formatMb(cacheStats.totalBytes)} MB used</span>
            <span>250.0 MB limit (LRU evicted)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
