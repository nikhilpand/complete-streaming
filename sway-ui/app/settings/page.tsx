'use client';

import React, { useState, useEffect } from 'react';
import {
  useLyricsSettings,
  getLyricsCSSVars,
  LyricsFontSize,
  LyricsLineHeight,
  LyricsFontFamily,
  LyricsContrast,
  LyricsBlur,
  LyricsAlign,
} from '@/store/useLyricsSettings';
import {
  Sliders,
  Type,
  Eye,
  AlignLeft,
  AlignCenter,
  Sparkles,
  RotateCcw,
  Music,
  Check,
  Radio,
  Server,
  Database,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const {
    fontSize,
    lineHeight,
    fontFamily,
    contrast,
    blur,
    align,
    showAccentBar,
    showRomanized,
    perTrackSyncOffset,
    setFontSize,
    setLineHeight,
    setFontFamily,
    setContrast,
    setBlur,
    setAlign,
    setShowAccentBar,
    setShowRomanized,
    applyPreset,
    resetDefaults,
  } = useLyricsSettings();

  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Check backend health
  useEffect(() => {
    fetch('/api/proxy/health')
      .then((res) => (res.ok ? setBackendStatus('connected') : setBackendStatus('offline')))
      .catch(() => setBackendStatus('offline'));
  }, []);

  const cssVars = getLyricsCSSVars({
    fontSize,
    lineHeight,
    fontFamily,
    contrast,
    blur,
    align,
    showAccentBar,
    showRomanized,
    perTrackSyncOffset,
  } as any);

  const presets = [
    { id: 'minimal', title: 'Minimal', desc: 'Clean, no blur, standard spacing' },
    { id: 'cinematic', title: 'Cinematic', desc: 'High contrast, atmospheric blur, relaxed' },
    { id: 'bold', title: 'Big & Bold', desc: 'Large typography, prominent accent bar' },
    { id: 'dense', title: 'Dense', desc: 'Compact line height for long verses' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10 text-foreground">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Display & Lyrics Settings</h1>
          <p className="text-sm text-muted mt-1">
            Personalize typography, Devanagari rendering, focus contrast, and stage layout.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetDefaults();
            setActivePreset(null);
          }}
          className="self-start md:self-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all cursor-pointer"
        >
          <RotateCcw size={14} />
          <span>Reset All Defaults</span>
        </button>
      </div>

      {/* Live Interactive Preview Card */}
      <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
              Live Stage Preview (Devanagari)
            </span>
          </div>
          <span className="text-xs text-white/40">Hanuman Ansh — Parvati</span>
        </div>

        {/* Preview Lyrics Viewport */}
        <div
          className={`p-8 md:p-12 min-h-[260px] flex flex-col justify-center bg-gradient-to-b from-zinc-950/70 to-zinc-900/60 ${
            showAccentBar ? 'blyrics-accent-bar' : ''
          }`}
          style={cssVars}
        >
          <div id="blyrics-container" style={{ maxWidth: '100%', padding: 0 }}>
            {/* Passed Line */}
            <div className="blyrics--line blyrics--passed">
              <span className="blyrics--word">भोले बाबा के द्वारे पे आए</span>
              {showRomanized && (
                <span className="w-full text-xs text-white/40 block mt-0.5">
                  Bhole baba ke dware pe aaye
                </span>
              )}
            </div>

            {/* Active Line */}
            <div className="blyrics--line blyrics--active">
              <span className="blyrics--word">पार्वती बोले शंकर से सुनिए त्रिपुरारी</span>
              {showRomanized && (
                <span className="w-full text-xs text-white/70 block mt-0.5">
                  Parvati bole shankar se suniye tripurari
                </span>
              )}
            </div>

            {/* Upcoming Line */}
            <div className="blyrics--line blyrics--neighbor">
              <span className="blyrics--word">तेरा डमरू बाजे पर्वतों के बीच</span>
              {showRomanized && (
                <span className="w-full text-xs text-white/40 block mt-0.5">
                  Tera damru baaje parvaton ke beech
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Preset Cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
          <Sparkles size={16} className="text-amber-400" />
          <span>Curated Style Presets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {presets.map((p) => {
            const isSelected = activePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  applyPreset(p.id as any);
                  setActivePreset(p.id);
                }}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-white/15 border-white/40 shadow-lg ring-1 ring-white/30'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-white">{p.title}</span>
                    {isSelected && <Check size={14} className="text-white" />}
                  </div>
                  <p className="text-xs text-muted mt-1 leading-snug">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detailed Typography & Layout Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Font Family */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Type size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold text-white">Devanagari Font Family</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'noto' as LyricsFontFamily, label: 'Noto Sans', sub: 'Traditional' },
              { id: 'mukta' as LyricsFontFamily, label: 'Mukta', sub: 'Contemporary' },
              { id: 'system' as LyricsFontFamily, label: 'System', sub: 'Clean sans' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFontFamily(f.id);
                  setActivePreset(null);
                }}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  fontFamily === f.id
                    ? 'bg-white/20 border-white/30 text-white font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                }`}
              >
                <div className="text-xs">{f.label}</div>
                <div className="text-[10px] text-muted opacity-75">{f.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold text-white">Lyrics Font Scale</h2>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['sm', 'md', 'lg', 'xl'] as LyricsFontSize[]).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  setFontSize(sz);
                  setActivePreset(null);
                }}
                className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer ${
                  fontSize === sz
                    ? 'bg-white/20 border-white/30 text-white font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="text-xs uppercase font-medium">{sz}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Line Spacing */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Sliders size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold text-white">Line Spacing (Shirorekha Safe)</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'compact' as LyricsLineHeight, label: 'Compact (1.25)' },
              { id: 'normal' as LyricsLineHeight, label: 'Normal (1.45)' },
              { id: 'relaxed' as LyricsLineHeight, label: 'Relaxed (1.75)' },
            ].map((lh) => (
              <button
                key={lh.id}
                type="button"
                onClick={() => {
                  setLineHeight(lh.id);
                  setActivePreset(null);
                }}
                className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  lineHeight === lh.id
                    ? 'bg-white/20 border-white/30 text-white font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="text-xs">{lh.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Inactive Lines Blur */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold text-white">Distant Lines Soft Blur</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'off' as LyricsBlur, label: 'Off (Crisp)' },
              { id: 'light' as LyricsBlur, label: 'Subtle (1.2px)' },
              { id: 'strong' as LyricsBlur, label: 'Cinematic (2.5px)' },
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setBlur(b.id);
                  setActivePreset(null);
                }}
                className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  blur === b.id
                    ? 'bg-white/20 border-white/30 text-white font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="text-xs">{b.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Contrast / Opacity */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold text-white">Inactive Contrast</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'high' as LyricsContrast, label: 'High Focus' },
              { id: 'medium' as LyricsContrast, label: 'Balanced' },
              { id: 'subtle' as LyricsContrast, label: 'Soft Reading' },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setContrast(c.id);
                  setActivePreset(null);
                }}
                className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  contrast === c.id
                    ? 'bg-white/20 border-white/30 text-white font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-muted hover:text-white hover:bg-white/10'
                }`}
              >
                <span className="text-xs">{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Layout Alignment & Accents */}
        <div className="p-5 rounded-2xl bg-surface-elevated/40 border border-white/10 space-y-3">
          <h2 className="text-sm font-semibold text-white">Visual Alignment & Accent</h2>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Text Alignment</span>
              <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setAlign('left')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-all cursor-pointer ${
                    align === 'left' ? 'bg-white/20 text-white font-medium' : 'text-muted'
                  }`}
                >
                  <AlignLeft size={13} />
                  <span>Left</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAlign('center')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-all cursor-pointer ${
                    align === 'center' ? 'bg-white/20 text-white font-medium' : 'text-muted'
                  }`}
                >
                  <AlignCenter size={13} />
                  <span>Center</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Active Line Indicator Bar</span>
              <button
                type="button"
                onClick={() => setShowAccentBar(!showAccentBar)}
                className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                  showAccentBar ? 'bg-white/40' : 'bg-white/10'
                }`}
                aria-pressed={showAccentBar}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    showAccentBar ? 'left-[22px]' : 'left-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Phonetic Romanized Subtitles</span>
              <button
                type="button"
                onClick={() => setShowRomanized(!showRomanized)}
                className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                  showRomanized ? 'bg-white/40' : 'bg-white/10'
                }`}
                aria-pressed={showRomanized}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    showRomanized ? 'left-[22px]' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Backend & Storage Status */}
      <div className="p-6 rounded-2xl bg-surface-elevated/30 border border-white/10 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Server size={16} className="text-muted" />
          <span>Recommendation Engine & Cloud Sync</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
            <span className="text-muted">Recommendation Service</span>
            <span
              className={`font-semibold flex items-center gap-1.5 ${
                backendStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  backendStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {backendStatus === 'connected' ? 'Port 8000 Active' : 'Connecting…'}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
            <span className="text-muted">Synced Offsets Saved</span>
            <span className="font-mono font-medium text-white">
              {Object.keys(perTrackSyncOffset).length} tracks
            </span>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
            <span className="text-muted">Storage Sync</span>
            <span className="text-white/80">Local & Cloud Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}
