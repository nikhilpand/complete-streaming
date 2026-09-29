'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowDownToLine, Music2, Check, AlertCircle, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { resolvePlaylistByUrl } from '@/lib/api/playlists';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { Artwork } from '@/components/artwork/Artwork';
import { formatCount } from '@/lib/utils';
import type { Playlist } from '@/lib/api/types';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

interface Props {
  isOpen: boolean;
  onClose: () => void;
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

export function ImportPlaylistModal({ isOpen, onClose }: Props) {
  const router = useRouter();
  const createPlaylist = useCustomPlaylists((s) => s.createPlaylist);

  useOverlayHistory(isOpen, onClose, 'modal-import-playlist');

  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Playlist | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setUrl('');
      setPlatform('unknown');
      setLoading(false);
      setError(null);
      setPreview(null);
      setCustomTitle('');
      setIsImporting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setPlatform('unknown');
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }

    const detected = detectPlatform(trimmed);
    setPlatform(detected);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    // Only auto-fetch if it looks like a full URL or ID
    if (
      trimmed.includes('playlist') ||
      trimmed.includes('list=') ||
      trimmed.startsWith('spotify:') ||
      trimmed.startsWith('youtube:') ||
      trimmed.length >= 22
    ) {
      debounceTimer.current = setTimeout(() => {
        handleInspect(trimmed);
      }, 400);
    }
  }, [url]);

  async function handleInspect(targetUrl: string) {
    if (!targetUrl.trim()) return;

    abortControllerRef.current?.abort();
    const ac = new AbortController();
    abortControllerRef.current = ac;

    setLoading(true);
    setError(null);

    try {
      const res = await resolvePlaylistByUrl(targetUrl.trim(), ac.signal);
      if (ac.signal.aborted) return;
      if (!res || !res.songs || res.songs.length === 0) {
        setError('No playable tracks found in this playlist.');
        setPreview(null);
        return;
      }
      setPreview(res);
      setCustomTitle(res.title || 'Imported Playlist');
    } catch (err: any) {
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      setPreview(null);
      setError(err?.message || 'Could not resolve playlist. Please verify the link is public.');
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }

  function handleImport() {
    if (!preview || !preview.songs?.length) return;
    setIsImporting(true);

    const titleToUse = customTitle.trim() || preview.title || 'Imported Playlist';
    const description = `Imported from ${preview.provider.toUpperCase()} (${preview.owner ? `Curated by ${preview.owner}` : 'Public Playlist'})`;

    const newId = createPlaylist(titleToUse, description, preview.songs);
    setIsImporting(false);
    onClose();
    router.push(`/playlist/${newId}`);
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          key="import-pl-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-md"
        />

        <motion.div
          key="import-pl-modal"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-lg rounded-[--radius-2xl] bg-[--surface-elevated] border border-white/[0.08] shadow-2xl p-6 z-10 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-playlist-title"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <ArrowDownToLine className="w-4 h-4" />
              </div>
              <div>
                <h3 id="import-playlist-title" className="text-base font-semibold text-[--foreground]">
                  Import Playlist
                </h3>
                <p className="text-xs text-[--muted]">From Spotify, YouTube Music, or JioSaavn</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1 rounded-md text-[--muted] hover:text-[--foreground] hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {/* Link Input */}
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
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/... or https://music.youtube.com/playlist?list=..."
                  className="w-full bg-white/[0.05] border border-white/10 rounded-[--radius-md] pl-3.5 pr-10 py-2.5 text-sm text-[--foreground] placeholder:text-[--muted]/50 outline-none focus:border-[--art-primary] transition-colors"
                />
                {loading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-[--muted] animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[--muted] mt-1.5">
                Paste any public link. We automatically extract and resolve every track with zero setup.
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-[--radius-md] bg-red-950/40 border border-red-800/40 text-red-200 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Preview Card */}
            {preview && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-[--radius-lg] bg-white/[0.03] border border-white/[0.07] space-y-3"
              >
                <div className="flex gap-3.5 items-center">
                  <Artwork
                    src={preview.artwork_url}
                    alt={preview.title}
                    size={64}
                    className="rounded-[--radius-md] flex-shrink-0 shadow-md"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[--art-primary]">
                      {preview.provider} Playlist
                    </span>
                    <h4 className="text-sm font-semibold text-[--foreground] truncate">
                      {preview.title}
                    </h4>
                    <p className="text-xs text-[--muted] truncate mt-0.5">
                      {preview.owner ? `By ${preview.owner}` : 'Curated collection'} ·{' '}
                      <span className="text-[--foreground] font-medium">
                        {preview.song_count || preview.songs?.length || 0} tracks
                      </span>
                    </p>
                  </div>
                </div>

                {/* Playlist Name Customize */}
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">
                    Save to Library as:
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-[--radius-sm] px-3 py-1.5 text-xs text-[--foreground] outline-none focus:border-[--art-primary]"
                  />
                </div>

                {/* Track snippet preview */}
                <div className="pt-1 border-t border-white/[0.05]">
                  <p className="text-[10px] uppercase font-mono text-[--muted] mb-1.5">Preview Tracks</p>
                  <div className="space-y-1">
                    {(preview.songs ?? []).slice(0, 3).map((song, i) => (
                      <div key={song.id || i} className="flex items-center gap-2 text-xs truncate text-[--muted]">
                        <span className="text-[10px] w-4 tabular-nums text-white/40">{i + 1}.</span>
                        <span className="text-[--foreground] truncate font-medium">{song.title}</span>
                        <span className="text-[--muted] truncate">
                          — {song.artists?.[0]?.name || 'Artist'}
                        </span>
                      </div>
                    ))}
                    {(preview.songs?.length ?? 0) > 3 && (
                      <p className="text-[10px] text-[--muted] pl-6 italic">
                        + {(preview.songs?.length ?? 0) - 3} more tracks
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[--muted] hover:text-[--foreground] transition-colors cursor-pointer"
              >
                Cancel
              </button>

              {!preview ? (
                <button
                  type="button"
                  disabled={loading || !url.trim()}
                  onClick={() => handleInspect(url.trim())}
                  className="px-5 py-2 bg-white/[0.08] text-[--foreground] hover:bg-white/[0.14] rounded-[--radius-md] text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Inspecting...
                    </>
                  ) : (
                    'Inspect Playlist'
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={handleImport}
                  className="px-5 py-2 bg-[--foreground] text-[--surface] rounded-[--radius-md] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer flex items-center gap-1.5 shadow-lg"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Import to Library
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
