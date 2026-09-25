'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Library, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Settings', href: '/settings', icon: Settings },
];

/**
 * Mobile bottom navigation bar. Visible only on small screens (below md breakpoint).
 * The player mini-bar is 80px tall; this nav sits at the very bottom.
 * On mobile, the main content pb is 80px (player) + 56px (this nav) = 136px.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 h-[56px] flex items-center border-t border-white/[0.07]">
      {/* Frosted glass surface */}
      <div className="absolute inset-0 bg-[--surface]/95 backdrop-blur-xl" />

      <div className="relative flex items-center justify-around w-full px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 px-4 py-2 rounded-md transition-colors min-w-0',
                isActive
                  ? 'text-[--foreground]'
                  : 'text-[--muted] hover:text-[--foreground]'
              )}
              aria-label={item.name}
            >
              <Icon className={cn('w-5 h-5', isActive && 'text-[--art-primary]')} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
