'use client';
import { useState } from 'react';
import { Music2 } from 'lucide-react';
import { cn, artUrl } from '@/lib/utils';

interface Props {
  src?: string | null;
  alt: string;
  size?: number;
  className?: string;
  priority?: boolean;
}

export function Artwork({ src, alt, size = 48, className }: Props) {
  const [err, setErr] = useState(false);
  const url = src ? artUrl(src) : '';

  if (!url || !url.trim() || err) {
    return (
      <div
        className={cn('bg-[--surface-elevated] flex items-center justify-center text-[--muted] flex-shrink-0', className)}
        style={{ width: size, height: size }}
        aria-label={alt}
      >
        <Music2 style={{ width: size * 0.35, height: size * 0.35 }} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      onError={() => setErr(true)}
      className={cn('object-cover flex-shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}
