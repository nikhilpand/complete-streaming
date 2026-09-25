'use client';
import dynamic from 'next/dynamic';

// Use dynamic with ssr:false here — this file IS a client component, so it's allowed
const ClientShellInner = dynamic(
  () => import('./ClientShell').then((m) => m.ClientShell),
  { ssr: false }
);

export function ClientShellLoader() {
  return <ClientShellInner />;
}
