'use client';
import { Volume2, VolumeX, Volume1 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { IconButton } from '@/components/ui/IconButton';

export function VolumeControl() {
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);

  const Icon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        sz="sm"
        onClick={() => {
          const next = !isMuted;
          audioManager?.setMuted(next);
          usePlayerStore.getState().setMuted(next);
        }}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        <Icon className="w-4 h-4" />
      </IconButton>
      <input
        type="range" min={0} max={1} step={0.02}
        value={isMuted ? 0 : volume}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          audioManager?.setVolume(v);
          usePlayerStore.getState().setVolume(v);
          if (isMuted && v > 0) {
            audioManager?.setMuted(false);
            usePlayerStore.getState().setMuted(false);
          }
        }}
        className="w-20 h-1 cursor-pointer accent-[--art-primary]"
        aria-label="Volume"
      />
    </div>
  );
}
