'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  Share2,
  Check,
  Heart,
  ListPlus,
  Mic2,
  Clock,
  Calendar,
  Disc3,
  ExternalLink,
  Sparkles,
  Download,
  Loader2,
} from 'lucide-react';
import { getSong, getSongLyrics } from '@/lib/api/songs';
import { recommendationToSong } from '@/lib/api/recommendations';
import { usePlayerStore } from '@/store/playerStore';
import { useLikedSongs } from '@/store/useLikedSongs';
import { Artwork } from '@/components/artwork/Artwork';
import { SongRow } from '@/components/music/SongRow';
import { AddToPlaylistModal } from '@/components/music/AddToPlaylistModal';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { formatMs, artistNames, cn } from '@/lib/utils';
import { downloadSong, type DownloadStatus } from '@/lib/download';
import type { Song, RecommendationTrack } from '@/lib/api/types';

export default function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const songId = decodeURIComponent(rawId);

  const [song, setSong] = useState<Song | null>(null);
  const [lyricsSnippet, setLyricsSnippet] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);

  // Player store state
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  // Liked songs
  const isLiked = useLikedSongs((s) => s.isLiked(song?.id));
  const toggleLike = useLikedSongs((s) => s.toggleLike);

  const isCurrentSong = currentTrack?.id === song?.id;
  const isPlaying = isCurrentSong && status === 'playing';

  // Load song details
  useEffect(() => {
    let active = true;
    const ac = new AbortController();

    setLoading(true);
    setError(null);

    getSong(songId, ac.signal)
      .then((data) => {
        if (!active) return;
        setSong(data);

        // Fetch lyrics snippet if available
        if (data.has_lyrics || data.lyrics_id) {
          getSongLyrics(data.id, ac.signal)
            .then((l) => {
              if (!active) return;
              if (l?.plain) {
                setLyricsSnippet(l.plain);
              } else if (l?.snippet) {
                setLyricsSnippet(l.snippet);
              }
            })
            .catch(() => {});
        }

        // Fetch recommendations for this track
        fetch(`/api/proxy/recommendations?current_track_id=${encodeURIComponent(data.id)}&n=8`, {
          signal: ac.signal,
        })
          .then((res) => (res.ok ? res.json() : []))
          .then((recs) => {
            if (active && Array.isArray(recs)) {
              setRecommendations(recs);
            }
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (!active || err?.name === 'AbortError') return;
        setError("Couldn't load this song. It may not exist or the backend is unreachable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      ac.abort();
    };
  }, [songId]);

  const handlePlayToggle = useCallback(() => {
    if (!song) return;
    if (isCurrentSong) {
      togglePlayPause();
    } else {
      setQueue([song], 0);
      setCurrentTrack(song);
    }
  }, [song, isCurrentSong, togglePlayPause, setQueue, setCurrentTrack]);

  const handleCopyLink = useCallback(() => {
    if (!song) return;
    const shareUrl = `${window.location.origin}/song/${encodeURIComponent(song.id)}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }, [song]);

  const handleDownload = useCallback(async (quality: 'best' | 'fast' = 'best') => {
    if (!song) return;
    try {
      await downloadSong(song, (s) => setDownloadStatus(s), quality);
    } catch {
      // Error handled by downloadSong
    }
  }, [song]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  // Convert recommendations to Song items safely
  const recSongs: Song[] = recommendations.map(recommendationToSong);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Hero Header */}
      <div className="flex flex-col md:flex-row gap-8 items-start md:items-end mb-10">
        {loading ? (
          <>
            <Skeleton className="w-52 h-52 md:w-60 md:h-60 rounded-[--radius-2xl] flex-shrink-0 shadow-2xl" />
            <div className="space-y-3 flex-1 w-full">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-10 w-3/4 max-w-md" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
              <div className="flex gap-3 pt-3">
                <Skeleton className="h-10 w-28 rounded-full" />
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
            </div>
          </>
        ) : song ? (
          <>
            {/* Artwork */}
            <div className="relative group w-52 h-52 md:w-60 md:h-60 rounded-[--radius-2xl] overflow-hidden flex-shrink-0 shadow-2xl bg-[--surface-elevated] ring-1 ring-white/10">
              <Artwork
                src={song.artwork_url}
                alt={song.title}
                size={240}
                className="w-full h-full object-cover select-none"
              />
              <button
                type="button"
                onClick={handlePlayToggle}
                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                <div className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform">
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current translate-x-0.5" />
                  )}
                </div>
              </button>
            </div>

            {/* Details */}
            <div className="min-w-0 space-y-3 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[--muted] uppercase tracking-widest font-mono">
                  Song
                </span>
                {song.is_explicit && (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/80">
                    EXPLICIT
                  </span>
                )}
              </div>

              <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight">
                {song.title}
              </h1>

              {/* Artist links */}
              <div className="flex flex-wrap items-center gap-x-2 text-base md:text-lg text-white/80">
                {song.artists && song.artists.length > 0 ? (
                  song.artists.map((artist, idx) => (
                    <span key={artist.id || idx} className="flex items-center">
                      {artist.id ? (
                        <Link
                          href={`/artist/${encodeURIComponent(artist.id)}`}
                          className="hover:text-white hover:underline transition-colors font-medium"
                        >
                          {artist.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{artist.name}</span>
                      )}
                      {song.artists && idx < song.artists.length - 1 && (
                        <span className="mr-1 text-white/40">,</span>
                      )}
                    </span>
                  ))
                ) : (
                  <span>{artistNames(song.artists, song.subtitle)}</span>
                )}
              </div>

              {/* Album & metadata */}
              <div className="flex flex-wrap items-center gap-3 text-xs md:text-sm text-white/50">
                {song.album && (
                  <div className="flex items-center gap-1.5">
                    <Disc3 className="w-4 h-4 text-white/40" />
                    {song.album_id ? (
                      <Link
                        href={`/album/${encodeURIComponent(song.album_id)}`}
                        className="hover:text-white hover:underline transition-colors"
                      >
                        {song.album}
                      </Link>
                    ) : (
                      <span>{song.album}</span>
                    )}
                  </div>
                )}
                {song.year && (
                  <>
                    <span>·</span>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-white/40" />
                      <span>{song.year}</span>
                    </div>
                  </>
                )}
                {song.duration_ms && (
                  <>
                    <span>·</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-white/40" />
                      <span>{formatMs(song.duration_ms)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handlePlayToggle}
                  className="flex items-center gap-2 px-6 py-2.5 bg-white text-black font-semibold text-sm rounded-full hover:bg-white/90 active:scale-95 transition-all shadow-lg cursor-pointer"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Play</span>
                    </>
                  )}
                </button>

                <IconButton
                  sz="md"
                  variant="filled"
                  onClick={() => toggleLike(song)}
                  className={cn(
                    'rounded-full',
                    isLiked ? 'text-rose-500 hover:text-rose-400' : 'text-white/60 hover:text-white'
                  )}
                  title={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
                  aria-label="Like song"
                >
                  <Heart className={cn('w-4 h-4', isLiked && 'fill-current')} />
                </IconButton>

                <IconButton
                  sz="md"
                  variant="filled"
                  onClick={() => setIsPlaylistModalOpen(true)}
                  className="rounded-full text-white/60 hover:text-white"
                  title="Add to Playlist"
                  aria-label="Add to Playlist"
                >
                  <ListPlus className="w-4 h-4" />
                </IconButton>

                {/* Download Button with Fast Option */}
                <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5">
                  <button
                    type="button"
                    onClick={() => handleDownload('best')}
                    disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
                    className={cn(
                      'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none',
                      downloadStatus === 'complete'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : downloadStatus === 'resolving' || downloadStatus === 'downloading'
                        ? 'bg-white/10 text-white/90 animate-pulse'
                        : 'hover:bg-white/[0.08] text-white/80 hover:text-white'
                    )}
                    title="Download Studio Quality (320kbps)"
                  >
                    {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[--art-primary,#6366f1]" />
                        <span>Starting...</span>
                      </>
                    ) : downloadStatus === 'complete' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Started</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                        <span className="text-[10px] text-white/40 font-mono">320k</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownload('fast')}
                    disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
                    className="px-2.5 py-1.5 rounded-full text-[10px] font-mono text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors cursor-pointer select-none border-l border-white/10"
                    title="Fast Download (160kbps · 2x Faster)"
                  >
                    Fast (2x)
                  </button>
                </div>

                {/* Copy Link Button */}
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium transition-all cursor-pointer select-none',
                    copied
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'border-white/10 hover:border-white/20 bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white'
                  )}
                  title="Copy permanent song link to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Copy Song Link</span>
                    </>
                  )}
                </button>

                {(song.has_lyrics || song.lyrics_id || lyricsSnippet) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCurrentSong) {
                        setQueue([song], 0);
                        setCurrentTrack(song);
                      }
                      toggleLyrics();
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-full border border-[--art-primary,#6366f1]/30 bg-[--art-primary,#6366f1]/10 text-white/90 hover:bg-[--art-primary,#6366f1]/20 transition-all text-xs font-medium cursor-pointer"
                  >
                    <Mic2 className="w-3.5 h-3.5 text-[--art-primary,#6366f1]" />
                    <span>View Lyrics</span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Lyrics Preview Section */}
      {lyricsSnippet && (
        <section className="mb-12 p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-[--art-primary]" />
              <h2 className="text-base font-semibold text-white">Lyrics Preview</h2>
            </div>
            <button
              onClick={() => {
                if (song && !isCurrentSong) {
                  setQueue([song], 0);
                  setCurrentTrack(song);
                }
                toggleLyrics();
              }}
              className="text-xs text-[--art-primary] hover:underline flex items-center gap-1 cursor-pointer font-medium"
            >
              <span>Fullscreen Karaoke</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
          <div className="font-sans text-sm md:text-base leading-relaxed text-white/70 whitespace-pre-line max-h-56 overflow-y-auto pr-2 select-text">
            {lyricsSnippet.slice(0, 450)}
            {lyricsSnippet.length > 450 ? '...' : ''}
          </div>
        </section>
      )}

      {/* Recommended Tracks Section */}
      {recSongs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h2 className="text-lg font-semibold text-white tracking-tight">More Like This</h2>
          </div>
          <div className="space-y-0.5">
            {recSongs.map((track, i) => (
              <SongRow key={track.id} song={track} index={i} context={recSongs} />
            ))}
          </div>
        </section>
      )}

      {/* Add To Playlist Modal */}
      {song && (
        <AddToPlaylistModal
          song={song}
          isOpen={isPlaylistModalOpen}
          onClose={() => setIsPlaylistModalOpen(false)}
        />
      )}
    </div>
  );
}
