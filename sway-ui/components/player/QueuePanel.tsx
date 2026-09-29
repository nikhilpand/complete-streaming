'use client';
import { useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListMusic, Sparkles, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { Artwork } from '@/components/artwork/Artwork';
import { artistNames, formatMs, cn } from '@/lib/utils';
import { getNextQueue, queueTrackToSong } from '@/lib/api/queue';
import type { QueueTrack } from '@/lib/api/types';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

export function QueuePanel() {
  const isOpen = usePlayerStore((s) => s.isQueueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);

  useOverlayHistory(isOpen, () => usePlayerStore.setState({ isQueueOpen: false }), 'queue');

  const [autoplayTracks, setAutoplayTracks] = useState<QueueTrack[]>([]);
  const [loadingAutoplay, setLoadingAutoplay] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentTrack?.id) {
      setAutoplayTracks([]);
      return;
    }
    const ac = new AbortController();
    setLoadingAutoplay(true);
    getNextQueue(currentTrack.id, 6, ac.signal)
      .then((tracks) => {
        if (!ac.signal.aborted) {
          const queueIds = new Set(queue.map((q) => q.id));
          const filtered = tracks.filter((t) => !queueIds.has(t.id) && t.id !== currentTrack.id);
          setAutoplayTracks(filtered);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setLoadingAutoplay(false);
      });
    return () => ac.abort();
  }, [isOpen, currentTrack?.id, queue]);

  const playAt = useCallback((index: number) => {
    const song = queue[index];
    if (!song) return;
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
              <div className="flex items-center gap-2">
                {queue.slice(queueIndex + 1).length > 0 && (
                  <button
                    onClick={() => clearQueue()}
                    className="text-[11px] font-medium text-[--muted] hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-white/[0.05] cursor-pointer"
                    title="Clear upcoming tracks"
                  >
                    Clear Up Next
                  </button>
                )}
                <button
                  onClick={toggleQueue}
                  className="w-7 h-7 flex items-center justify-center rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-colors cursor-pointer"
                  aria-label="Close queue"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
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
                      <div className="flex items-center justify-between mb-2 px-1">
                        <p className="text-[10px] font-mono text-[--muted] uppercase tracking-widest">Up Next</p>
                        <span className="text-[10px] text-[--muted]">{queue.length - 1 - queueIndex} tracks</span>
                      </div>
                      <div className="space-y-1">
                        {queue.slice(queueIndex + 1).map((song, offset) => {
                          const actualIndex = queueIndex + 1 + offset;
                          return (
                            <QueueRow
                              key={`${song.id}-${actualIndex}`}
                              song={song}
                              isActive={false}
                              onClick={() => playAt(actualIndex)}
                              onRemove={() => removeFromQueue(actualIndex)}
                              onMoveUp={offset > 0 ? () => moveQueueItem(actualIndex, actualIndex - 1) : undefined}
                              onMoveDown={
                                actualIndex < queue.length - 1
                                  ? () => moveQueueItem(actualIndex, actualIndex + 1)
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recommended Continuation */}
                  {autoplayTracks.length > 0 && (
                    <div className="px-4 mt-5">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-[--art-accent]" />
                          <p className="text-[10px] font-mono text-[--art-accent] uppercase tracking-widest">
                            Autoplay Next
                          </p>
                        </div>
                        <span className="text-[9px] font-mono text-[--muted] uppercase tracking-wider">
                          {loadingAutoplay ? 'Discovering...' : 'AI Sequenced'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {autoplayTracks.map((track) => (
                          <div
                            key={track.id}
                            className="group/auto flex items-center justify-between p-1.5 rounded-[--radius-sm] hover:bg-white/[0.05] transition-colors"
                          >
                            <button
                              onClick={() => {
                                const song = queueTrackToSong(track);
                                const updated = [...queue, song];
                                usePlayerStore.getState().setQueue(updated, updated.length - 1);
                                usePlayerStore.getState().setCurrentTrack(song);
                              }}
                              aria-label={`Play ${track.title} now`}
                              className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <div className="w-8 h-8 rounded-[--radius-xs] overflow-hidden flex-shrink-0 bg-white/[0.07]">
                                <Artwork src={track.artwork_url} alt={track.title} size={32} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-[--foreground] truncate group-hover/auto:text-[--art-accent] transition-colors">
                                  {track.title}
                                </p>
                                <p className="text-[10px] text-[--muted] truncate">
                                  {track.artist_name || (track.artists && track.artists[0]?.name) || 'Unknown Artist'}
                                </p>
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const song = queueTrackToSong(track);
                                usePlayerStore.getState().addToQueue(song);
                                setAutoplayTracks((prev) => prev.filter((t) => t.id !== track.id));
                              }}
                              aria-label={`Add ${track.title} to queue`}
                              title="Add to queue"
                              className="p-1 text-[--muted] hover:text-[--foreground] opacity-60 group-hover/auto:opacity-100 transition cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
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
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  song: { id: string; title: string; artists?: Array<{ name: string }>; artwork_url?: string; subtitle?: string; duration_ms?: number };
  isActive: boolean;
  isDimmed?: boolean;
  onClick: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Play ${song.title}`}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className={cn(
        'group flex items-center gap-2.5 w-full px-2 py-2 rounded-[--radius-sm] text-left transition-colors cursor-pointer select-none',
        isActive
          ? 'bg-[--art-primary]/15 hover:bg-[--art-primary]/20'
          : 'hover:bg-white/[0.06]',
        isDimmed && 'opacity-40 hover:opacity-70'
      )}
    >
      {/* Artwork */}
      <div className="relative w-9 h-9 rounded-[--radius-xs] overflow-hidden flex-shrink-0 bg-white/[0.07]">
        <Artwork src={song.artwork_url} alt={song.title} size={36} className="w-full h-full object-cover" />
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

      {/* Duration & Hover Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {song.duration_ms && (
          <span className={cn('text-[11px] font-mono text-[--muted]', (onMoveUp || onMoveDown || onRemove) && 'group-hover:hidden')}>
            {formatMs(song.duration_ms)}
          </span>
        )}

        {(onMoveUp || onMoveDown || onRemove) && (
          <div className="hidden group-hover:flex items-center gap-0.5">
            {onMoveUp && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                className="p-1 rounded text-[--muted] hover:text-[--foreground] hover:bg-white/[0.1] transition-colors cursor-pointer"
                title="Move up"
                aria-label="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            )}
            {onMoveDown && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
                className="p-1 rounded text-[--muted] hover:text-[--foreground] hover:bg-white/[0.1] transition-colors cursor-pointer"
                title="Move down"
                aria-label="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="p-1 rounded text-[--muted] hover:text-red-400 hover:bg-white/[0.1] transition-colors cursor-pointer"
                title="Remove from queue"
                aria-label="Remove from queue"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
