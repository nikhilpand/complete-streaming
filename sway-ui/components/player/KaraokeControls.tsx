'use client';

import { useKaraokeStore } from '@/lib/karaoke/karaokeStore';
import { Mic2, Volume2, Music2, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function KaraokeControls() {
  const mode = useKaraokeStore((s) => s.mode);
  const status = useKaraokeStore((s) => s.status);
  const progress = useKaraokeStore((s) => s.progress);
  const ready = useKaraokeStore((s) => s.ready);
  const error = useKaraokeStore((s) => s.error);
  const vocalVolume = useKaraokeStore((s) => s.vocalVolume);
  const setMode = useKaraokeStore((s) => s.setMode);
  const setVocalVolume = useKaraokeStore((s) => s.setVocalVolume);

  const isPreparing = status === 'queued' || status === 'processing';
  const isFailed = status === 'failed';
  const isUnavailable = status === 'unavailable';

  if (isUnavailable) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Karaoke</span>
        {isPreparing && (
          <div className="flex items-center gap-1.5 text-white/50">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px]">{Math.round(progress * 100)}%</span>
          </div>
        )}
        {isFailed && (
          <div className="flex items-center gap-1 text-red-400/70">
            <AlertCircle className="w-3 h-3" />
            <span className="text-[10px]">Failed</span>
          </div>
        )}
      </div>

      {/* Mode buttons */}
      <div className="flex gap-1.5">
        {([
          { key: 'original', label: 'Original', Icon: Music2 },
          { key: 'karaoke',  label: 'Karaoke',  Icon: Mic2 },
          { key: 'sing',     label: 'Sing',      Icon: Volume2 },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            disabled={!ready && key !== 'original'}
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-medium transition-all',
              mode === key
                ? 'bg-white/15 text-white'
                : 'bg-white/[0.04] text-white/40 hover:text-white/70 hover:bg-white/[0.07]',
              !ready && key !== 'original' && 'opacity-30 cursor-not-allowed pointer-events-none',
            )}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Vocal volume slider — only in sing mode */}
      {mode === 'sing' && ready && (
        <div className="flex items-center gap-2 pt-1">
          <Volume2 className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vocalVolume}
            onChange={(e) => setVocalVolume(parseFloat(e.target.value))}
            className="w-full h-1 cursor-pointer accent-white"
            aria-label="Vocal volume"
          />
          <span className="text-[10px] text-white/40 w-7 text-right flex-shrink-0">
            {Math.round(vocalVolume * 100)}%
          </span>
        </div>
      )}

      {/* Error message */}
      {isFailed && error && (
        <p className="text-[10px] text-red-400/60 leading-relaxed">{error}</p>
      )}

      {/* Preparing progress bar */}
      {isPreparing && (
        <div className="w-full h-[2px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/40 rounded-full transition-all duration-500"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
