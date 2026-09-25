'use client';
import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListMusic, Music2 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { audioManager } from '@/lib/audio/AudioManager';
import { artUrl, artistNames, formatMs, cn } from '@/lib/utils';

export function QueuePanel() {
  const isOpen = usePlayerStore((s) => s.isQueueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);

  const playAt = useCallback((index: number) => {
    const song = queue[index];
    if (!song) return;
    audioManager?.init();
    usePlayerStore.getState().setQueue(queue, index);
    usePlayerStore.getState().setCurrentTrack(song);
  }, [queue]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="queue-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40"
          onClick={toggleQueue}
        />
      )}
      {isOpen && (
        <motion.aside
          key="queue-panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed right-0 top-0 bottom-0 z-50 w-[340px] flex flex-col overflow-hidden"
          style={{ paddingBottom: '80px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Glass surface */}
          <div className="absolute inset-0 bg-[--surface]/95 backdrop-blur-2xl border-l border-white/[0.07]" />

          <div className="relative flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <ListMusic className="w-4 h-4 text-[--muted]" />
                <h2 className="text-sm font-semibold text-[--foreground]">Queue</h2>
                {queue.length > 0 && (
                  <span className="text-[11px] text-[--muted] font-mono bg-white/[0.07] px-1.5 py-0.5 rounded-sm">
                    {queue.length}
                  </span>
                )}
              </div>
              <button
                onClick={toggleQueue}
                className="w-7 h-7 flex items-center justify-center rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-colors cursor-pointer"
                aria-label="Close queue"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Queue list */}
            <div className="flex-1 overflow-y-auto py-2">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-6">
                  <ListMusic className="w-10 h-10 text-white/15" />
                  <p className="text-sm text-[--muted]">Queue is empty</p>
                  <p className="text-xs text-[--muted] opacity-60">Play a song or album to add tracks here</p>
                </div>
              ) : (
                <>
                  {/* Now Playing */}
                  {currentTrack && (
                    <div className="px-4 mb-1">
                      <p className="text-[10px] font-mono text-[--muted] uppercase tracking-widest mb-2 px-1">Now Playing</p>
                      <QueueRow song={currentTrack} isActive onClick={() => {}} />
                    </div>
                  )}

                  {/* Up next */}
                  {queue.slice(queueIndex + 1).length > 0 && (
                    <div className="px-4 mt-4">
                      <p className="text-[10px] font-mono text-[--muted] uppercase tracking-widest mb-2 px-1">Up Next</p>
                      {queue.slice(queueIndex + 1).map((song, offset) => {
                        const actualIndex = queueIndex + 1 + offset;
                        return (
                          <QueueRow
                            key={`${song.id}-${actualIndex}`}
                            song={song}
                            isActive={false}
                            onClick={() => playAt(actualIndex)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* History */}
                  {queueIndex > 0 && (
                    <div className="px-4 mt-4">
                      <p className="text-[10px] font-mono text-[--muted]/60 uppercase tracking-widest mb-2 px-1">History</p>
                      {queue.slice(0, queueIndex).map((song, index) => (
                        <QueueRow
                          key={`${song.id}-${index}`}
                          song={song}
                          isActive={false}
                          isDimmed
                          onClick={() => playAt(index)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function QueueRow({
  song,
  isActive,
  isDimmed = false,
  onClick,
}: {
  song: { id: string; title: string; artists?: Array<{ name: string }>; artwork_url?: string; subtitle?: string; duration_ms?: number };
  isActive: boolean;
  isDimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 w-full px-2 py-2 rounded-[--radius-sm] group text-left transition-colors cursor-pointer',
        isActive
          ? 'bg-[--art-primary]/15 hover:bg-[--art-primary]/20'
          : 'hover:bg-white/[0.06]',
        isDimmed && 'opacity-40 hover:opacity-70'
      )}
    >
      {/* Artwork */}
      <div className="relative w-9 h-9 rounded-[--radius-xs] overflow-hidden flex-shrink-0 bg-white/[0.07]">
        {song.artwork_url ? (
          <img src={artUrl(song.artwork_url)} alt={song.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 className="w-4 h-4 text-white/20" />
          </div>
        )}
        {isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-0.5 bg-[--art-accent] rounded-full animate-bounce"
                  style={{ height: '10px', animationDelay: `${i * 0.1}s`, animationDuration: '0.8s' }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-xs font-medium truncate',
          isActive ? 'text-[--art-accent]' : 'text-[--foreground]'
        )}>
          {song.title}
        </p>
        <p className="text-[11px] text-[--muted] truncate">
          {artistNames(song.artists, song.subtitle)}
        </p>
      </div>

      {/* Duration */}
      {song.duration_ms && (
        <span className="text-[11px] font-mono text-[--muted] flex-shrink-0">
          {formatMs(song.duration_ms)}
        </span>
      )}
    </button>
  );
}
