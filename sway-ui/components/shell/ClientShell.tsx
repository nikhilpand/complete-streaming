'use client';
import { Player } from '@/components/player/GlobalPlayer';
import { LyricsPanel } from '@/components/player/LyricsPanel';
import { QueuePanel } from '@/components/player/QueuePanel';
import { PlaybackController } from '@/components/shell/PlaybackController';
import { SearchCommand } from '@/components/search/SearchCommand';
import { MobileNav } from '@/components/shell/MobileNav';
import { RouteScrollReset } from '@/components/shell/RouteScrollReset';
import { SessionResumeBanner } from '@/components/shell/SessionResumeBanner';

/**
 * All client-only overlay components bundled together.
 * Imported via dynamic() with ssr:false from the Server Component layout
 * to avoid browser-API crashes during SSR.
 */
export default function ClientShell() {
  return (
    <>
      <RouteScrollReset />
      <SessionResumeBanner />
      <PlaybackController />
      <Player />
      <LyricsPanel />
      <QueuePanel />
      <SearchCommand />
      <MobileNav />
    </>
  );
}

export { ClientShell };
