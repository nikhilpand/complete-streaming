'use client';

import { useState, useCallback } from 'react';
import { useKaraokeStore } from '@/lib/karaoke/karaokeStore';
import { usePlayerStore } from '@/store/playerStore';
import { resolveMedia } from '@/lib/api/songs';
import { Mic2, Volume2, Music2, Loader2, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function KaraokeControls() {
  const mode        = useKaraokeStore((s) => s.mode);
  const status      = useKaraokeStore((s) => s.status);
  const progress    = useKaraokeStore((s) => s.progress);
  const ready       = useKaraokeStore((s) => s.ready);
  const error       = useKaraokeStore((s) => s.error);
  const vocalVolume = useKaraokeStore((s) => s.vocalVolume);
  const setMode          = useKaraokeStore((s) => s.setMode);
  const setVocalVolume   = useKaraokeStore((s) => s.setVocalVolume);
  const prepareForTrack  = useKaraokeStore((s) => s.prepareForTrack);

  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const isPreparing  = status === 'queued' || status === 'processing';
  const isFailed     = status === 'failed';
  const isNotPrepared = status === 'not_prepared';

  // ── Trigger preparation: resolve stream URL then call prepareForTrack ──────
  const handlePrepare = useCallback(async () => {
    if (!currentTrack) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      const media = await resolveMedia(currentTrack.id);
      if (!media?.streams?.length) {
        setTriggerError("Couldn't resolve a stream for this track.");
        return;
      }
      // Pick the highest-bitrate stream
      const best = [...media.streams].sort(
        (a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0)
      )[0];
      await prepareForTrack(
        currentTrack.id,
        best.url,
        currentTrack.provider ? `${currentTrack.provider}:${currentTrack.provider_id ?? currentTrack.id}` : undefined,
      );
    } catch (e) {
      setTriggerError((e as Error).message || 'Failed to start preparation.');
    } finally {
      setTriggering(false);
    }
  }, [currentTrack, prepareForTrack]);

  if (!currentTrack) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
          Karaoke
        </span>
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
        {ready && (
          <span className="text-[10px] text-emerald-400/70 font-medium">Ready</span>
        )}
      </div>

      {/* ── NOT PREPARED: show a Prepare button ───────────────────────────── */}
      {isNotPrepared && (
        <button
          onClick={handlePrepare}
          disabled={triggering}
          className={cn(
            'flex items-center justify-center gap-2 w-full py-2 rounded-xl text-[12px] font-medium transition-all',
            'bg-white/[0.07] text-white/70 hover:bg-white/[0.12] hover:text-white',
            triggering && 'opacity-50 cursor-not-allowed pointer-events-none',
          )}
        >
          {triggering ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {triggering ? 'Preparing…' : 'Enable Karaoke'}
        </button>
      )}

      {/* ── PREPARING: progress bar ────────────────────────────────────────── */}
      {isPreparing && (
        <>
          <p className="text-[10px] text-white/40 text-center">
            Separating vocals — this may take a minute…
          </p>
          <div className="w-full h-[2px] bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/40 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </>
      )}

      {/* ── FAILED: error + retry ─────────────────────────────────────────── */}
      {isFailed && (
        <>
          {(error || triggerError) && (
            <p className="text-[10px] text-red-400/60 leading-relaxed">
              {error || triggerError}
            </p>
          )}
          <button
            onClick={handlePrepare}
            disabled={triggering}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-xl text-[11px] text-white/50 hover:text-white/80 bg-white/[0.04] hover:bg-white/[0.08] transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </>
      )}

      {/* ── READY: mode selector ──────────────────────────────────────────── */}
      {ready && (
        <div className="flex gap-1.5">
          {([
            { key: 'original', label: 'Original', Icon: Music2 },
            { key: 'karaoke',  label: 'Karaoke',  Icon: Mic2 },
            { key: 'sing',     label: 'Sing',      Icon: Volume2 },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-medium transition-all',
                mode === key
                  ? 'bg-white/15 text-white'
                  : 'bg-white/[0.04] text-white/40 hover:text-white/70 hover:bg-white/[0.07]',
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── SING: vocal volume slider ─────────────────────────────────────── */}
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

      {/* Trigger error (resolve media failed) */}
      {triggerError && !isFailed && (
        <p className="text-[10px] text-red-400/60">{triggerError}</p>
      )}
    </div>
  );
}
