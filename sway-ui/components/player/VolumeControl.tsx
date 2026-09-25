'use client';
import { Volume2, VolumeX, Volume1 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { IconButton } from '@/components/ui/IconButton';

export function VolumeControl() {
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);

  const Icon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        sz="sm"
        onClick={() => setMuted(!isMuted)}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        <Icon className="w-4 h-4" />
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={isMuted ? 0 : volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        className="w-20 h-1 cursor-pointer accent-[--art-primary]"
        aria-label="Volume"
      />
    </div>
  );
}
