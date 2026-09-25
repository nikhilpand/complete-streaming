'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Settings, Disc } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Library', href: '/library', icon: Library },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[240px] flex-shrink-0 border-r border-border/50 bg-surface flex flex-col pt-6 hidden md:flex">
      <div className="px-6 mb-8 flex items-center gap-2">
        <Disc className="w-8 h-8 text-foreground" />
        <span className="text-xl font-bold tracking-tight">SWAY</span>
      </div>
      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium',
                isActive
                  ? 'bg-surface-elevated text-foreground'
                  : 'text-muted hover:text-foreground hover:bg-surface-elevated/50'
              )}
            >
              <Icon className="w-5 h-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 px-3 py-2 w-full rounded-md transition-colors text-sm font-medium',
            pathname === '/settings'
              ? 'bg-surface-elevated text-foreground'
              : 'text-muted hover:text-foreground hover:bg-surface-elevated/50'
          )}
        >
          <Settings className="w-5 h-5" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
