'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Check, ListMusic, Music } from 'lucide-react';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { Artwork } from '@/components/artwork/Artwork';
import { artistNames, cn } from '@/lib/utils';
import type { Song } from '@/lib/api/types';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

interface Props {
  song: Song | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AddToPlaylistModal({ song, isOpen, onClose }: Props) {
  const playlists = useCustomPlaylists((s) => s.playlists);
  const createPlaylist = useCustomPlaylists((s) => s.createPlaylist);
  const addSongToPlaylist = useCustomPlaylists((s) => s.addSongToPlaylist);
  const removeSongFromPlaylist = useCustomPlaylists((s) => s.removeSongFromPlaylist);

  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useOverlayHistory(isOpen && !!song, onClose, 'modal-add-to-playlist');

  if (!isOpen || !song) return null;

  function handleToggle(playlistId: string, isContained: boolean) {
    if (!song) return;
    if (isContained) {
      removeSongFromPlaylist(playlistId, song.id);
    } else {
      addSongToPlaylist(playlistId, song);
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !song) return;
    createPlaylist(newTitle.trim(), undefined, [song]);
    setNewTitle('');
    setIsCreating(false);
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        />

        {/* Modal content */}
        <motion.div
          key="modal-content"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-md rounded-[--radius-xl] bg-[--surface-elevated] border border-white/[0.08] shadow-2xl overflow-hidden p-6 z-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-to-playlist-title"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <ListMusic className="w-5 h-5 text-[--art-accent]" />
              <h3 id="add-to-playlist-title" className="text-base font-semibold text-[--foreground]">Add to Playlist</h3>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1 rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Song target info */}
          <div className="flex items-center gap-3 my-4 p-2.5 rounded-[--radius-md] bg-white/[0.03] border border-white/[0.04]">
            <Artwork src={song.artwork_url} alt={song.title} size={40} className="rounded-[--radius-xs]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[--foreground] truncate">{song.title}</p>
              <p className="text-xs text-[--muted] truncate">{artistNames(song.artists, song.subtitle)}</p>
            </div>
          </div>

          {/* Create new playlist trigger/form */}
          <div className="mb-4">
            {!isCreating ? (
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-2 w-full py-2.5 px-3 rounded-[--radius-md] border border-dashed border-white/20 text-xs font-medium text-[--muted] hover:text-[--foreground] hover:border-white/40 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[--art-accent]" />
                <span>New playlist</span>
              </button>
            ) : (
              <form onSubmit={handleCreate} className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Playlist name..."
                  className="flex-1 bg-white/[0.06] border border-white/10 rounded-[--radius-md] px-3 py-1.5 text-xs text-[--foreground] placeholder:text-[--muted] outline-none focus:border-[--art-accent]"
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="px-3 py-1.5 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setNewTitle('');
                  }}
                  className="px-2 py-1.5 text-xs text-[--muted] hover:text-[--foreground] cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>

          {/* Existing playlists list */}
          <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
            {playlists.length === 0 ? (
              <div className="text-center py-6 text-xs text-[--muted]">
                No custom playlists yet. Create one above!
              </div>
            ) : (
              playlists.map((pl) => {
                const isContained = pl.songs.some((s) => s.id === song.id);
                return (
                  <button
                    key={pl.id}
                    onClick={() => handleToggle(pl.id, isContained)}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2.5 rounded-[--radius-md] text-left transition-colors cursor-pointer group',
                      isContained
                        ? 'bg-[--art-primary]/15 hover:bg-[--art-primary]/25'
                        : 'hover:bg-white/[0.05]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-[--radius-xs] bg-white/[0.06] flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {pl.songs[0]?.artwork_url ? (
                          <Artwork src={pl.songs[0].artwork_url} alt={pl.title} size={32} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-4 h-4 text-[--muted]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[--foreground] truncate">{pl.title}</p>
                        <p className="text-[10px] text-[--muted] truncate">
                          {pl.songs.length} {pl.songs.length === 1 ? 'song' : 'songs'}
                        </p>
                      </div>
                    </div>

                    <div
                      className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center border transition-all',
                        isContained
                          ? 'bg-[--foreground] text-[--surface] border-transparent'
                          : 'border-white/20 group-hover:border-white/40'
                      )}
                    >
                      {isContained && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
