'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Copy, Download, Share2, Sparkles, Image as ImageIcon } from 'lucide-react';
import type { ParsedLyricLine } from '@/lib/lyric-parser';
import { getProxiedImageUrl } from '@/lib/api';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

export type CardTheme = 'artwork' | 'gradient' | 'oled' | 'editorial';
export type CardAspect = 'square' | 'story';

interface LyricShareCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: {
    id: string;
    title: string;
    artist: string;
    artwork_url?: string;
    album?: string;
  };
  lyrics: ParsedLyricLine[];
  initialActiveIndex?: number;
}

export function LyricShareCardModal({
  isOpen,
  onClose,
  track,
  lyrics,
  initialActiveIndex = 0,
}: LyricShareCardModalProps) {
  useOverlayHistory(isOpen, onClose, 'modal-lyric-share-card');
  // Filter out empty lines
  const validLines = useMemo(() => {
    return lyrics
      .map((line, idx) => ({ ...line, originalIdx: idx }))
      .filter((l) => Boolean(l.text && l.text.trim() && !l.isInstrumental));
  }, [lyrics]);

  // Find nearest valid line to initialActiveIndex
  const defaultSelectedIdx = useMemo(() => {
    if (!validLines.length) return [];
    const found = validLines.find((l) => l.originalIdx >= initialActiveIndex) || validLines[0];
    return [found.originalIdx];
  }, [validLines, initialActiveIndex]);

  const [selectedIndices, setSelectedIndices] = useState<number[]>(defaultSelectedIdx);
  const [theme, setTheme] = useState<CardTheme>('artwork');
  const [aspect, setAspect] = useState<CardAspect>('story');
  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const previewCardRef = useRef<HTMLDivElement>(null);

  // Sync selected index when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedIndices(defaultSelectedIdx);
      setCopied(false);
      setExportError(null);
    }
  }, [isOpen, defaultSelectedIdx]);

  const toggleLine = (idx: number) => {
    setSelectedIndices((prev) => {
      if (prev.includes(idx)) {
        if (prev.length === 1) return prev; // Keep at least one line selected
        return prev.filter((i) => i !== idx);
      } else {
        if (prev.length >= 5) return prev; // Limit to 5 lines for aesthetics
        return [...prev, idx].sort((a, b) => a - b);
      }
    });
  };

  const selectedLines = useMemo(() => {
    return selectedIndices
      .map((idx) => lyrics[idx]?.text?.trim())
      .filter(Boolean) as string[];
  }, [selectedIndices, lyrics]);

  // High-res canvas renderer for export
  const renderCardToCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const canvas = document.createElement('canvas');
    const width = 1080;
    const height = aspect === 'story' ? 1920 : 1080;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Backgrounds according to theme
    if (theme === 'oled') {
      ctx.fillStyle = '#060709';
      ctx.fillRect(0, 0, width, height);

      // Subtle perimeter border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 4;
      ctx.strokeRect(40, 40, width - 80, height - 80);
    } else if (theme === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1a102f');
      grad.addColorStop(0.5, '#0d1527');
      grad.addColorStop(1, '#070b12');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Radial glow
      const rad = ctx.createRadialGradient(width * 0.3, height * 0.25, 40, width * 0.3, height * 0.25, 600);
      rad.addColorStop(0, 'rgba(120, 60, 220, 0.35)');
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, width, height);
    } else if (theme === 'editorial') {
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(0, 0, width, height);

      // Monochromatic subtle grid/accent
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(60, 60, width - 120, height - 120);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2;
      ctx.strokeRect(60, 60, width - 120, height - 120);
    } else {
      // Artwork glow / wash
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, width, height);

      // If artwork is present, draw blurred copy
      if (track.artwork_url) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = getProxiedImageUrl(track.artwork_url, 500, 500);
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            setTimeout(res, 1200); // timeout fallback
          });
          ctx.save();
          ctx.filter = 'blur(70px) brightness(0.4) saturate(1.8)';
          ctx.drawImage(img, -100, -100, width + 200, height + 200);
          ctx.restore();
        } catch {}
      }

      // Vignette
      const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.2, width / 2, height / 2, width * 0.7);
      vig.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
      vig.addColorStop(1, 'rgba(4, 6, 12, 0.85)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }

    // ── Header: Album Art & Track Info ──
    const margin = 120;
    let currentY = aspect === 'story' ? 260 : 160;

    // Load thumbnail for header
    if (track.artwork_url) {
      try {
        const thumb = new Image();
        thumb.crossOrigin = 'anonymous';
        thumb.src = getProxiedImageUrl(track.artwork_url, 300, 300);
        await new Promise((res) => {
          thumb.onload = res;
          thumb.onerror = res;
          setTimeout(res, 800);
        });
        const artSize = 130;
        ctx.save();
        // Round rect
        ctx.beginPath();
        const r = 24;
        ctx.roundRect(margin, currentY, artSize, artSize, r);
        ctx.clip();
        ctx.drawImage(thumb, margin, currentY, artSize, artSize);
        ctx.restore();

        // Border around art
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(margin, currentY, artSize, artSize, r);
        ctx.stroke();

        // Text beside artwork
        const textX = margin + artSize + 36;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
        const truncatedTitle = track.title.length > 24 ? track.title.slice(0, 24) + '…' : track.title;
        ctx.fillText(truncatedTitle, textX, currentY + 54);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.font = '500 32px system-ui, -apple-system, sans-serif';
        const truncatedArtist = track.artist.length > 32 ? track.artist.slice(0, 32) + '…' : track.artist;
        ctx.fillText(truncatedArtist, textX, currentY + 102);

        currentY += artSize + 100;
      } catch {
        currentY += 80;
      }
    }

    // ── Quote Lines ──
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px system-ui, -apple-system, sans-serif';
    const lineHeight = 84;
    const maxTextWidth = width - margin * 2;

    for (const lineText of selectedLines) {
      // Simple word wrapping
      const words = lineText.split(' ');
      let currentLine = '';

      for (let n = 0; n < words.length; n++) {
        const testLine = currentLine + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth && n > 0) {
          ctx.fillText(currentLine.trim(), margin, currentY);
          currentLine = words[n] + ' ';
          currentY += lineHeight;
        } else {
          currentLine = testLine;
        }
      }
      ctx.fillText(currentLine.trim(), margin, currentY);
      currentY += lineHeight + 20;
    }

    // ── Footer: SWAY Branding Badge ──
    const footerY = height - 120;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '600 24px monospace, system-ui';
    ctx.fillText('SWAY · sway.music', margin, footerY);

    return canvas;
  }, [aspect, theme, track, selectedLines]);

  const handleCopyImage = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const canvas = await renderCardToCanvas();
      if (!canvas) throw new Error('Canvas rendering failed');

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setExportError('Could not generate image blob');
          setIsExporting(false);
          return;
        }
        try {
          if (navigator.clipboard && (window as any).ClipboardItem) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
          } else {
            handleDownloadPNG();
          }
        } catch {
          // If clipboard write is rejected by browser permission, fallback to direct download
          handleDownloadPNG();
        } finally {
          setIsExporting(false);
        }
      }, 'image/png');
    } catch (err: any) {
      setExportError(err?.message || 'Export error');
      setIsExporting(false);
    }
  };

  const handleDownloadPNG = async () => {
    setIsExporting(true);
    try {
      const canvas = await renderCardToCanvas();
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const safeTitle = track.title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
      a.download = `sway-quote-${safeTitle}.png`;
      a.href = dataUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err: any) {
      setExportError(err?.message || 'Download error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyText = () => {
    const textToCopy = `"${selectedLines.join('\n')}"\n\n— ${track.title} by ${track.artist}\nvia SWAY Music`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[3500] flex items-center justify-center p-4 sm:p-6 select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-xl"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-4xl max-h-[90vh] bg-zinc-950/95 border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row text-white z-10"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>

          {/* Left Panel: Line Selector */}
          <div className="w-full md:w-1/2 p-5 flex flex-col border-b md:border-b-0 md:border-r border-white/10 max-h-[45vh] md:max-h-[85vh]">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-amber-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Select Lyrics to Share
              </h2>
              <span className="text-[11px] text-white/50 ml-auto font-mono">
                {selectedIndices.length}/5 lines
              </span>
            </div>

            <p className="text-xs text-white/60 mb-3">
              Choose up to 5 memorable lines to generate a Spotify/Apple-style lyric card:
            </p>

            {/* Scrollable lines */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-2">
              {validLines.map((line) => {
                const isSelected = selectedIndices.includes(line.originalIdx);
                return (
                  <button
                    key={line.originalIdx}
                    type="button"
                    onClick={() => toggleLine(line.originalIdx)}
                    className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? 'bg-white/20 text-white font-medium shadow-sm border border-white/25'
                        : 'bg-white/[0.03] hover:bg-white/[0.08] text-white/70 border border-white/5'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border ${
                        isSelected
                          ? 'bg-emerald-500 border-emerald-400 text-white'
                          : 'border-white/30 bg-white/5'
                      }`}
                    >
                      {isSelected && <Check size={11} strokeWidth={3} />}
                    </div>
                    <span className="flex-1 leading-relaxed">{line.text}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Preview & Customization */}
          <div className="w-full md:w-1/2 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              {/* Card Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Theme Selector */}
                <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                  {(
                    [
                      { id: 'artwork', label: 'Artwork' },
                      { id: 'gradient', label: 'Dusk' },
                      { id: 'oled', label: 'OLED' },
                      { id: 'editorial', label: 'Editorial' },
                    ] as { id: CardTheme; label: string }[]
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                        theme === t.id
                          ? 'bg-white/25 text-white font-semibold shadow-sm'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Aspect Ratio */}
                <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setAspect('story')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      aspect === 'story'
                        ? 'bg-white/25 text-white font-semibold'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Story (9:16)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAspect('square')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      aspect === 'square'
                        ? 'bg-white/25 text-white font-semibold'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Square (1:1)
                  </button>
                </div>
              </div>

              {/* Card Live Visual Preview */}
              <div className="flex items-center justify-center p-2">
                <div
                  ref={previewCardRef}
                  className={`w-full max-w-[280px] rounded-2xl overflow-hidden relative border shadow-2xl flex flex-col justify-between p-5 transition-all ${
                    aspect === 'story' ? 'aspect-[9/15]' : 'aspect-square'
                  } ${
                    theme === 'oled'
                      ? 'bg-black border-white/20'
                      : theme === 'gradient'
                      ? 'bg-gradient-to-br from-indigo-950 via-slate-900 to-black border-indigo-500/20'
                      : theme === 'editorial'
                      ? 'bg-zinc-900 border-white/20'
                      : 'bg-zinc-950 border-white/15'
                  }`}
                  style={
                    theme === 'artwork' && track.artwork_url
                      ? {
                          backgroundImage: `radial-gradient(circle at 50% 30%, rgba(20,25,35,0.7), rgba(5,7,12,0.95)), url(${track.artwork_url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : {}
                  }
                >
                  {/* Top: Art & Metadata */}
                  <div className="flex items-center gap-3">
                    {track.artwork_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={track.artwork_url}
                        alt={track.title}
                        className="w-10 h-10 rounded-xl object-cover border border-white/20 shrink-0 shadow-md"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                        <ImageIcon size={18} className="text-white/60" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">{track.title}</p>
                      <p className="text-[10px] text-white/70 truncate">{track.artist}</p>
                    </div>
                  </div>

                  {/* Center: Quote Typography */}
                  <div className="my-auto py-3 space-y-2">
                    {selectedLines.map((text, idx) => (
                      <p
                        key={idx}
                        className={`font-bold leading-snug tracking-tight text-white ${
                          selectedLines.length <= 2
                            ? 'text-base sm:text-lg'
                            : selectedLines.length <= 3
                            ? 'text-sm sm:text-base'
                            : 'text-xs sm:text-sm'
                        }`}
                      >
                        {text}
                      </p>
                    ))}
                  </div>

                  {/* Bottom: SWAY Watermark */}
                  <div className="flex items-center justify-between text-[9px] text-white/50 font-mono pt-2 border-t border-white/10">
                    <span>SWAY</span>
                    <span>sway.music</span>
                  </div>
                </div>
              </div>

              {exportError && (
                <p className="text-[11px] text-rose-400 text-center font-medium">
                  {exportError}
                </p>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-white/10 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyImage}
                  disabled={isExporting || selectedLines.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-white text-black font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-white/90 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied Card!' : 'Copy Card'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPNG}
                  disabled={isExporting || selectedLines.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-white/15 hover:bg-white/25 active:scale-98 text-white font-semibold text-xs flex items-center justify-center gap-1.5 border border-white/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Download size={14} />
                  <span>Download PNG</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyText}
                className="w-full py-1.5 text-[11px] text-white/50 hover:text-white/80 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Share2 size={11} />
                <span>Copy lyrics as text</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
