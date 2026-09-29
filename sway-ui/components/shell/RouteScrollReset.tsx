'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * RouteScrollReset
 * Automatically resets the scroll position of the <main> container to (0, 0)
 * whenever the route pathname changes, eliminating scroll carry-over and visual jumps.
 */
export function RouteScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [pathname]);

  return null;
}
