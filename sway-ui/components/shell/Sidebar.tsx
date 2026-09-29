'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Settings, Disc, Mic2, User, Plus, ListMusic } from 'lucide-react';
import { useCustomPlaylists } from '@/store/useCustomPlaylists';
import { usePlayerStore } from '@/store/playerStore';
import { CreatePlaylistModal } from '@/components/music/CreatePlaylistModal';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Lyrics', href: '/lyrics', icon: Mic2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const playlists = useCustomPlaylists((s) => s.playlists);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isLyricsOpen = usePlayerStore((s) => s.isLyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);

  const [isCreating, setIsCreating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <aside className="w-[240px] flex-shrink-0 border-r border-white/[0.04] bg-[#0a0a0f] flex flex-col pt-8 hidden md:flex transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
        {/* Brand */}
        <div className="px-7 mb-8 flex items-center gap-3">
          <Disc className="w-7 h-7 text-white" />
          <span className="text-sm font-light tracking-[0.3em] uppercase text-white/90">
            <strong className="font-bold">S</strong>WAY
          </span>
        </div>

        {/* Primary Nav */}
        <nav className="space-y-0.5 mb-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isLyrics = item.name === 'Lyrics';
            const isActive = isLyrics ? isLyricsOpen : pathname === item.href;

            if (isLyrics && currentTrack) {
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={toggleLyrics}
                  className={cn(
                    'w-full flex items-center gap-4 px-7 py-2.5 transition-colors text-[13px] font-medium border-l-2 text-left cursor-pointer select-none',
                    isActive
                      ? 'border-[--art-primary] text-white bg-white/[0.02]'
                      : 'border-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.04]'
                  )}
                >
                  <Icon className={cn('w-4 h-4 opacity-80', isLyricsOpen && 'text-[--art-primary]')} />
                  {item.name}
                </button>
              );
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-4 px-7 py-2.5 transition-colors text-[13px] font-medium border-l-2',
                  isActive
                    ? 'border-[--art-primary] text-white bg-white/[0.02]'
                    : 'border-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.04]'
                )}
              >
                <Icon className="w-4 h-4 opacity-80" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Playlists Section */}
        <div className="flex-1 flex flex-col min-h-0 px-7 pt-4 border-t border-white/[0.04]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/40">
              Playlists
            </span>
            <button
              onClick={() => setIsCreating(true)}
              className="p-1 rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              title="Create Playlist"
              aria-label="Create Playlist"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-0.5">
            {!mounted ? (
              <div className="py-2 px-2">
                <div className="h-4 w-24 bg-white/[0.04] rounded animate-pulse" />
              </div>
            ) : playlists.length === 0 ? (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full text-left py-2 px-2 text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Create playlist</span>
              </button>
            ) : (
              playlists.map((pl) => {
                const href = `/playlist/${pl.id}`;
                const isActive = pathname === href;
                return (
                  <Link
                    key={pl.id}
                    href={href}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors truncate',
                      isActive
                        ? 'text-white bg-white/[0.06] font-medium'
                        : 'text-white/60 hover:text-white/90 hover:bg-white/[0.03]'
                    )}
                  >
                    <ListMusic className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                    <span className="truncate">{pl.title}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Footer / Settings & Profile */}
        <div className="pb-6 pt-3 border-t border-white/[0.04]">
          <div className="space-y-0.5 mb-6">
            <Link
              href="/settings"
              className={cn(
                'flex items-center gap-4 px-7 py-2.5 transition-colors text-[13px] font-medium border-l-2',
                pathname === '/settings'
                  ? 'border-[--art-primary] text-white bg-white/[0.02]'
                  : 'border-transparent text-white/60 hover:text-white/90 hover:bg-white/[0.04]'
              )}
            >
              <Settings className="w-4 h-4 opacity-80" />
              Settings
            </Link>
          </div>
          <div className="px-7 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-white/50" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-white/80">Guest User</span>
              <span className="text-[10px] text-white/40">Local Session</span>
            </div>
          </div>
        </div>
      </aside>

      <CreatePlaylistModal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
      />
    </>
  );
}
