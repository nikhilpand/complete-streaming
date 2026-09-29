'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListPlus, ArrowDownToLine, Check, AlertCircle, Loader2 } from 'lucide-react';
import { resolvePlaylistByUrl } from '@/lib/api/playlists';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { Artwork } from '@/components/artwork/Artwork';
import type { Playlist } from '@/lib/api/types';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'create' | 'import';
}

type Platform = 'spotify' | 'youtube' | 'saavn' | 'unknown';

function detectPlatform(url: string): Platform {
  const lower = url.toLowerCase().trim();
  if (lower.includes('spotify.com') || lower.includes('spotify.link') || lower.startsWith('spotify:')) {
    return 'spotify';
  }
  if (
    lower.includes('music.youtube.com') ||
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.startsWith('youtube:') ||
    lower.startsWith('yt:')
  ) {
    return 'youtube';
  }
  if (lower.includes('jiosaavn.com') || lower.includes('saavn.com') || lower.startsWith('saavn:')) {
    return 'saavn';
  }
  return 'unknown';
}

export function CreatePlaylistModal({ isOpen, onClose, defaultTab = 'create' }: Props) {
  const router = useRouter();
  const createPlaylist = useCustomPlaylists((s) => s.createPlaylist);

  useOverlayHistory(isOpen, onClose, 'modal-create-playlist');

  const [activeTab, setActiveTab] = useState<'create' | 'import'>(defaultTab);

  // Blank state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Import state
  const [importUrl, setImportUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Playlist | null>(null);
  const [customImportTitle, setCustomImportTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  function handleCreateBlank(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const newId = createPlaylist(title.trim(), description.trim() || undefined);
    setTitle('');
    setDescription('');
    onClose();
    router.push(`/playlist/${newId}`);
  }

  async function handleInspectImport() {
    if (!importUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await resolvePlaylistByUrl(importUrl.trim());
      if (!res || !res.songs || res.songs.length === 0) {
        setError('No playable tracks found in this playlist.');
        setPreview(null);
        return;
      }
      setPreview(res);
      setCustomImportTitle(res.title || 'Imported Playlist');
    } catch (err: any) {
      setPreview(null);
      setError(err?.message || 'Could not resolve playlist. Please ensure the playlist is public.');
    } finally {
      setLoading(false);
    }
  }

  function handleFinishImport() {
    if (!preview || !preview.songs?.length) return;
    setIsImporting(true);
    const titleToUse = customImportTitle.trim() || preview.title || 'Imported Playlist';
    const desc = `Imported from ${preview.provider.toUpperCase()} (${preview.owner ? `Curated by ${preview.owner}` : 'Public Playlist'})`;
    const newId = createPlaylist(titleToUse, desc, preview.songs);
    setIsImporting(false);
    onClose();
    router.push(`/playlist/${newId}`);
  }

  const platform = detectPlatform(importUrl);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          key="create-pl-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-md"
        />

        <motion.div
          key="create-pl-modal"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-lg rounded-[--radius-2xl] bg-[--surface-elevated] border border-white/[0.08] shadow-2xl p-6 z-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-playlist-title"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header & Tabs */}
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setActiveTab('create'); setError(null); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-[--radius-md] text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'create'
                    ? 'bg-white/[0.1] text-[--foreground]'
                    : 'text-[--muted] hover:text-[--foreground]'
                }`}
              >
                <ListPlus className="w-4 h-4 text-[--art-primary]" />
                New Blank
              </button>
              <button
                onClick={() => { setActiveTab('import'); setError(null); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-[--radius-md] text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'import'
                    ? 'bg-white/[0.1] text-[--foreground]'
                    : 'text-[--muted] hover:text-[--foreground]'
                }`}
              >
                <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                Import (Spotify / YT Music)
              </button>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1 rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab 1: Blank Playlist */}
          {activeTab === 'create' ? (
            <form onSubmit={handleCreateBlank} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[--muted] mb-1.5 uppercase tracking-wider font-mono">
                  Playlist Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Late Night Drives, Focus Flow"
                  className="w-full bg-white/[0.05] border border-white/10 rounded-[--radius-md] px-3.5 py-2.5 text-sm text-[--foreground] placeholder:text-[--muted]/60 outline-none focus:border-[--art-primary] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[--muted] mb-1.5 uppercase tracking-wider font-mono">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Give your playlist a vibe or note..."
                  className="w-full bg-white/[0.05] border border-white/10 rounded-[--radius-md] px-3.5 py-2 text-sm text-[--foreground] placeholder:text-[--muted]/60 outline-none focus:border-[--art-primary] transition-colors resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-[--muted] hover:text-[--foreground] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="px-5 py-2 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer"
                >
                  Create Playlist
                </button>
              </div>
            </form>
          ) : (
            /* Tab 2: Import External Playlist */
            <div className="mt-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[--muted] uppercase tracking-wider font-mono">
                    Playlist Link or ID
                  </label>
                  {platform !== 'unknown' && (
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                        platform === 'spotify'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : platform === 'youtube'
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                      }`}
                    >
                      {platform === 'spotify'
                        ? 'Spotify'
                        : platform === 'youtube'
                        ? 'YouTube Music'
                        : 'JioSaavn'}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInspectImport()}
                    placeholder="https://open.spotify.com/playlist/... or https://music.youtube.com/playlist?list=..."
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-[--radius-md] px-3.5 py-2 text-sm text-[--foreground] placeholder:text-[--muted]/50 outline-none focus:border-[--art-primary] transition-colors"
                  />
                  <button
                    type="button"
                    disabled={loading || !importUrl.trim()}
                    onClick={handleInspectImport}
                    className="px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] text-[--foreground] rounded-[--radius-md] text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Inspect'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-[--radius-md] bg-red-950/40 border border-red-800/40 text-red-200 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}

              {preview && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3.5 rounded-[--radius-lg] bg-white/[0.03] border border-white/[0.07] space-y-3"
                >
                  <div className="flex gap-3.5 items-center">
                    <Artwork
                      src={preview.artwork_url}
                      alt={preview.title}
                      size={54}
                      className="rounded-[--radius-md] flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[--art-primary]">
                        {preview.provider} Playlist
                      </span>
                      <h4 className="text-sm font-semibold text-[--foreground] truncate">
                        {preview.title}
                      </h4>
                      <p className="text-xs text-[--muted] truncate">
                        {preview.owner ? `By ${preview.owner}` : 'Curated collection'} ·{' '}
                        <span className="text-[--foreground] font-medium">
                          {preview.song_count || preview.songs?.length || 0} tracks
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">
                      Save to Library as:
                    </label>
                    <input
                      type="text"
                      value={customImportTitle}
                      onChange={(e) => setCustomImportTitle(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-[--radius-sm] px-3 py-1.5 text-xs text-[--foreground] outline-none focus:border-[--art-primary]"
                    />
                  </div>
                </motion.div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-[--muted] hover:text-[--foreground] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!preview || isImporting}
                  onClick={handleFinishImport}
                  className="px-5 py-2 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer flex items-center gap-1.5 shadow-lg"
                >
                  {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Import to Library
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
