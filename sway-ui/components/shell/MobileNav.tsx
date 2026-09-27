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

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center border-t border-white/[0.05] bg-[#0a0a0f]/95 backdrop-blur-2xl"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="relative flex items-center justify-around w-full px-2 h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = Boolean(
            pathname && (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)))
          );
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 w-12 min-h-[48px] rounded-md transition-colors min-w-0 relative group',
                isActive
                  ? 'text-white'
                  : 'text-[#9090a0] hover:text-white'
              )}
              aria-label={item.name}
            >
              <Icon className={cn('w-[22px] h-[22px] mb-1', isActive && 'text-white')} />
              {isActive && (
                <span className="absolute bottom-1 w-4 h-0.5 rounded-full bg-[--art-primary]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
