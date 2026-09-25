'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useLyricsSettings,
  LyricsFontSize,
  LyricsLineHeight,
  LyricsFontFamily,
  LyricsContrast,
  LyricsBlur,
  LyricsAlign,
} from '@/store/useLyricsSettings';
import { Settings2, RotateCcw, ExternalLink, Check } from 'lucide-react';
import Link from 'next/link';

interface LyricsSettingsPopoverProps {
  currentTrackId?: string;
  onNavigateSettings?: () => void;
}

export function LyricsSettingsPopover({
  currentTrackId,
  onNavigateSettings,
}: LyricsSettingsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const {
    fontSize,
    lineHeight,
    fontFamily,
    contrast,
    blur,
    align,
    showAccentBar,
    setFontSize,
    setLineHeight,
    setFontFamily,
    setContrast,
    setBlur,
    setAlign,
    setShowAccentBar,
    setTrackSyncOffset,
    getTrackSyncOffset,
    resetDefaults,
  } = useLyricsSettings();

  const currentOffset = currentTrackId ? getTrackSyncOffset(currentTrackId) : 0;

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Lyrics display settings"
        aria-expanded={isOpen}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer backdrop-blur-2xl border ${
          isOpen
            ? 'bg-white/25 border-white/30 text-white shadow-lg'
            : 'bg-white/10 hover:bg-white/20 border-white/15 text-white/80 hover:text-white'
        }`}
        title="Customize typography & sync"
      >
        <span className="font-semibold text-sm tracking-tight font-serif select-none">Aa</span>
      </button>

      {/* Popover Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-3 w-80 max-h-[85vh] overflow-y-auto rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-white/15 shadow-2xl p-4 text-white z-[3000] space-y-4 select-none"
            style={{
              boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 1px rgba(255, 255, 255, 0.2)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-white/70" />
                <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
                  Lyrics Settings
                </span>
              </div>
              <button
                type="button"
                onClick={resetDefaults}
                className="text-[11px] text-white/50 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset to defaults"
              >
                <RotateCcw size={11} />
                <span>Reset</span>
              </button>
            </div>

            {/* Font Size */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                Font Size
              </label>
              <div className="grid grid-cols-4 gap-1.5 bg-white/5 p-1 rounded-xl border border-white/10">
                {(['sm', 'md', 'lg', 'xl'] as LyricsFontSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setFontSize(sz)}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      fontSize === sz
                        ? 'bg-white/25 text-white shadow-sm'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {sz.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                Font Style
              </label>
              <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {[
                  { id: 'noto' as LyricsFontFamily, label: 'Noto Sans' },
                  { id: 'mukta' as LyricsFontFamily, label: 'Mukta' },
                  { id: 'system' as LyricsFontFamily, label: 'System' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFontFamily(item.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium truncate transition-all cursor-pointer ${
                      fontFamily === item.id
                        ? 'bg-white/25 text-white shadow-sm'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Line Spacing */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                Line Spacing
              </label>
              <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {[
                  { id: 'compact' as LyricsLineHeight, label: 'Compact' },
                  { id: 'normal' as LyricsLineHeight, label: 'Normal' },
                  { id: 'relaxed' as LyricsLineHeight, label: 'Relaxed' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLineHeight(item.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium truncate transition-all cursor-pointer ${
                      lineHeight === item.id
                        ? 'bg-white/25 text-white shadow-sm'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inactive Lines Blur */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                Background Blur
              </label>
              <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {[
                  { id: 'off' as LyricsBlur, label: 'Off' },
                  { id: 'light' as LyricsBlur, label: 'Subtle' },
                  { id: 'strong' as LyricsBlur, label: 'Strong' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setBlur(item.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium truncate transition-all cursor-pointer ${
                      blur === item.id
                        ? 'bg-white/25 text-white shadow-sm'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contrast / Opacity */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                Contrast
              </label>
              <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {[
                  { id: 'high' as LyricsContrast, label: 'High' },
                  { id: 'medium' as LyricsContrast, label: 'Balanced' },
                  { id: 'subtle' as LyricsContrast, label: 'Soft' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setContrast(item.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium truncate transition-all cursor-pointer ${
                      contrast === item.id
                        ? 'bg-white/25 text-white shadow-sm'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Alignment & Accent Bar Toggles */}
            <div className="pt-2 border-t border-white/10 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/75">Active Line Accent Bar</span>
                <button
                  type="button"
                  onClick={() => setShowAccentBar(!showAccentBar)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    showAccentBar ? 'bg-white/40' : 'bg-white/10'
                  }`}
                  aria-pressed={showAccentBar}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      showAccentBar ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-white/75">Alignment</span>
                <div className="flex gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => setAlign('left')}
                    className={`px-2 py-0.5 text-[11px] rounded transition-all cursor-pointer ${
                      align === 'left' ? 'bg-white/25 text-white font-medium' : 'text-white/50'
                    }`}
                  >
                    Left
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlign('center')}
                    className={`px-2 py-0.5 text-[11px] rounded transition-all cursor-pointer ${
                      align === 'center' ? 'bg-white/25 text-white font-medium' : 'text-white/50'
                    }`}
                  >
                    Center
                  </button>
                </div>
              </div>
            </div>

            {/* Per-Track Timing Offset */}
            {currentTrackId && (
              <div className="pt-2 border-t border-white/10 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/75">Sync Offset</span>
                  <span className="text-xs font-mono font-medium text-white/90">
                    {currentOffset > 0 ? `+${currentOffset}ms` : `${currentOffset}ms`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={-2000}
                    max={2000}
                    step={25}
                    value={currentOffset}
                    onChange={(e) =>
                      setTrackSyncOffset(currentTrackId, parseInt(e.target.value, 10))
                    }
                    className="w-full accent-white h-1.5 bg-white/10 rounded-lg cursor-pointer"
                  />
                  {currentOffset !== 0 && (
                    <button
                      type="button"
                      onClick={() => setTrackSyncOffset(currentTrackId, 0)}
                      className="text-[10px] text-white/60 hover:text-white px-1.5 py-0.5 bg-white/10 rounded"
                    >
                      0
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-white/40 leading-tight">
                  Press [ or ] to nudge sync timing by 50ms
                </p>
              </div>
            )}

            {/* Link to Full Settings */}
            <div className="pt-2 border-t border-white/10 text-center">
              <Link
                href="/settings"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateSettings?.();
                }}
                className="inline-flex items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white hover:underline transition-colors py-1"
              >
                <span>More settings & presets</span>
                <ExternalLink size={12} />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
