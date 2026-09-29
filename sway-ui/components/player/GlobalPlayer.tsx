'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  List,
  Mic2,
  Repeat,
  Shuffle,
  Repeat1,
  X,
  Heart,
  Share2,
  Check,
  Download,
  Loader2,
  Sliders,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '@/store/playerStore';
import { useLikedSongs } from '@/store/useLikedSongs';
import { useAudioSettings } from '@/store/useAudioSettings';
import { Artwork } from '@/components/artwork/Artwork';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from './ProgressBar';
import { VolumeControl } from './VolumeControl';
import { SleepTimerControl } from './SleepTimerControl';
import { ShortcutsModal } from './ShortcutsModal';
import { EqualizerModal } from './EqualizerModal';
import { cn, artistNames } from '@/lib/utils';
import { downloadSong, type DownloadStatus } from '@/lib/download';

export function Player() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const status = usePlayerStore((s) => s.status);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const isShuffled = usePlayerStore((s) => s.isShuffled);
  const isLyricsOpen = usePlayerStore((s) => s.isLyricsOpen);
  const error = usePlayerStore((s) => s.error);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrev = usePlayerStore((s) => s.playPrev);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);
  const togglePlayPause = usePlayerStore((s) => s.togglePlayPause);
  const isLiked = useLikedSongs((s) => s.isLiked(currentTrack?.id));
  const toggleLike = useLikedSongs((s) => s.toggleLike);
  const toggleEqModal = useAudioSettings((s) => s.toggleEqualizerModal);
  const eqEnabled = useAudioSettings((s) => s.eqEnabled);

  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');

  const handleCopySongLink = useCallback(() => {
    if (!currentTrack) return;
    const url = `${window.location.origin}/song/${encodeURIComponent(currentTrack.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [currentTrack]);

  const handleDownloadCurrentTrack = useCallback(async () => {
    if (!currentTrack) return;
    try {
      await downloadSong(currentTrack, (s) => setDownloadStatus(s));
    } catch {
      // Handled in downloadSong
    }
  }, [currentTrack]);

  if (!currentTrack) return null;

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  const PlayPauseBtn = (
    <IconButton
      sz="lg"
      variant="prominent"
      className="rounded-full w-10 h-10"
      disabled={isLoading}
      onClick={togglePlayPause}
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-[--surface]/40 border-t-[--surface] rounded-full animate-spin" />
      ) : isPlaying ? (
        <Pause className="w-4 h-4 fill-current" />
      ) : (
        <Play className="w-4 h-4 fill-current translate-x-0.5" />
      )}
    </IconButton>
  );

  return (
    <>
      {/* Mini Player - auto hides when FullScreenLyrics is active */}
      <AnimatePresence>
        {!isLyricsOpen && (
          <motion.div
            key="mini"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px))] md:bottom-0 left-0 right-0 z-40 h-[80px]"
          >
            <div className="absolute inset-0 bg-[--surface]/90 backdrop-blur-xl border-t border-white/[0.06]" />
            <ProgressBar />
            <div className="relative h-full flex flex-col px-4">
              <div className="flex-1 flex items-center gap-3 pb-1 h-full pt-1">
                {/* Track info - animated on track change */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={currentTrack.id}
                      className="flex items-center gap-3 flex-1 min-w-0"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <button
                        type="button"
                        onClick={toggleLyrics}
                        className="relative group/art shrink-0 cursor-pointer rounded-[--radius-sm] overflow-hidden"
                        title="Open Fullscreen Lyrics & Stage"
                        aria-label="Open lyrics view"
                      >
                        <Artwork
                          src={currentTrack.artwork_url}
                          alt={currentTrack.title}
                          size={42}
                          className="rounded-[--radius-sm] group-hover/art:opacity-85 transition-opacity ring-1 ring-white/10 shadow-lg"
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/art:opacity-100 transition-opacity flex items-center justify-center">
                          <Mic2 className="w-3.5 h-3.5 text-white" />
                        </div>
                      </button>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/song/${encodeURIComponent(currentTrack.id)}`}
                          className="block text-sm font-medium text-[--foreground] hover:text-[--art-primary] hover:underline truncate transition-colors cursor-pointer"
                          title={`View song: ${currentTrack.title}`}
                        >
                          {currentTrack.title}
                        </Link>
                        <div className="text-xs text-[--muted] truncate">
                          {currentTrack.artists && currentTrack.artists.length > 0 && currentTrack.artists[0]?.id ? (
                            <Link
                              href={`/artist/${encodeURIComponent(currentTrack.artists[0].id)}`}
                              className="hover:text-[--foreground] hover:underline transition-colors"
                              title={`Artist: ${currentTrack.artists[0].name}`}
                            >
                              {artistNames(currentTrack.artists, currentTrack.subtitle)}
                            </Link>
                          ) : (
                            <span>{artistNames(currentTrack.artists, currentTrack.subtitle)}</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                  <IconButton
                    sz="sm"
                    onClick={() => toggleLike(currentTrack)}
                    className={cn(
                      'shrink-0 hover:scale-110 transition-all hidden sm:inline-flex',
                      isLiked ? 'text-rose-500 hover:text-rose-400' : 'text-white/40 hover:text-white/80'
                    )}
                    aria-label={isLiked ? 'Unlike song' : 'Like song'}
                    title={isLiked ? 'Unlike song' : 'Like song'}
                  >
                    <Heart className={cn('w-4 h-4', isLiked && 'fill-current')} />
                  </IconButton>
                  <IconButton
                    sz="sm"
                    onClick={handleDownloadCurrentTrack}
                    disabled={downloadStatus === 'resolving' || downloadStatus === 'downloading'}
                    className="shrink-0 hover:scale-110 transition-all text-white/40 hover:text-white"
                    title={
                      downloadStatus === 'complete'
                        ? 'Downloaded!'
                        : downloadStatus === 'resolving' || downloadStatus === 'downloading'
                        ? 'Downloading audio...'
                        : 'Download song (320kbps)'
                    }
                    aria-label="Download song"
                  >
                    {downloadStatus === 'resolving' || downloadStatus === 'downloading' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[--art-primary]" />
                    ) : downloadStatus === 'complete' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </IconButton>
                  <IconButton
                    sz="sm"
                    onClick={handleCopySongLink}
                    className="shrink-0 hover:scale-110 transition-all text-white/40 hover:text-white"
                    title={copied ? 'Song link copied!' : 'Copy song link'}
                    aria-label="Copy song link"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
                  </IconButton>
                </div>

                {/* Center controls */}
                <div className="flex items-center gap-1 flex-shrink-0 sm:flex-1 justify-end sm:justify-center">
                  <IconButton sz="sm"
                    onClick={() => usePlayerStore.getState().toggleShuffle()}
                    className={cn('hidden sm:inline-flex', isShuffled && 'text-[--art-primary]')}
                    aria-label="Shuffle"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton sz="sm" onClick={playPrev} aria-label="Previous">
                    <SkipBack className="w-4 h-4 fill-current" />
                  </IconButton>
                  {PlayPauseBtn}
                  <IconButton sz="sm" onClick={playNext} aria-label="Next">
                    <SkipForward className="w-4 h-4 fill-current" />
                  </IconButton>
                  <IconButton sz="sm"
                    onClick={() => usePlayerStore.getState().cycleRepeat()}
                    className={cn('hidden sm:inline-flex', repeatMode !== 'none' && 'text-[--art-primary]')}
                    aria-label="Repeat"
                  >
                    <RepeatIcon className="w-3.5 h-3.5" />
                  </IconButton>
                </div>

                {/* Right controls */}
                <div className="hidden md:flex items-center gap-1 flex-1 justify-end">
                  <SleepTimerControl />
                  <IconButton
                    sz="sm"
                    onClick={toggleEqModal}
                    aria-label="Equalizer & DSP"
                    title={eqEnabled ? 'Studio Equalizer (Active)' : 'Studio Equalizer'}
                    className={cn(eqEnabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-white/60 hover:text-white')}
                  >
                    <Sliders className="w-4 h-4" />
                  </IconButton>
                  <IconButton sz="sm" onClick={toggleLyrics} aria-label="Lyrics" title="Lyrics (Full Screen)">
                    <Mic2 className="w-4 h-4 text-[--art-primary]" />
                  </IconButton>
                  <IconButton sz="sm" onClick={toggleQueue} aria-label="Queue"><List className="w-4 h-4" /></IconButton>
                  <VolumeControl />
                </div>
              </div>
            </div>
            {error && (
              <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-red-500/20 text-red-200 text-[11px] px-3 py-1.5 rounded-full border border-red-500/30 backdrop-blur-md flex items-center gap-3 z-50 shadow-lg">
                <span>{error}</span>
                <button onClick={() => usePlayerStore.getState().setError(null)} className="cursor-pointer hover:bg-white/10 rounded-full p-0.5 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <ShortcutsModal />
      <EqualizerModal />
    </>
  );
}
