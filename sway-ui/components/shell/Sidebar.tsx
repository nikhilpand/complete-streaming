'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Settings, Disc, Mic2, User } from 'lucide-react';
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

  return (
    <aside className="w-[240px] flex-shrink-0 border-r border-white/[0.04] bg-[#0a0a0f] flex flex-col pt-8 hidden md:flex transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
      <div className="px-7 mb-10 flex items-center gap-3">
        <Disc className="w-7 h-7 text-white" />
        <span className="text-sm font-light tracking-[0.3em] uppercase text-white/90">
          <strong className="font-bold">S</strong>WAY
        </span>
      </div>
      <nav className="flex-1 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
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
      <div className="pb-6">
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
  );
}
