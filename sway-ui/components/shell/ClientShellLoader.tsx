'use client';

import { useEffect, useState } from 'react';
import { ClientShell } from './ClientShell';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Mounts client-only overlays only on the client after hydration.
 * Returns null during SSR to avoid browser-API issues and hydration mismatches.
 * Eliminates next/dynamic lazy-promise undefined errors in Next 16 webpack dev server.
 */
export function ClientShellLoader() {
  const [mounted, setMounted] = useState(false);
  const [shellKey, setShellKey] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <ErrorBoundary onReset={() => setShellKey((k) => k + 1)} resetKey={shellKey}>
      <ClientShell key={shellKey} />
    </ErrorBoundary>
  );
}
