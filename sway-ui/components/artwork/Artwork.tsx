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
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const url = src ? artUrl(src) : '';
  const isFailed = Boolean(url && failedUrl === url);

  const hasExplicitWidth = className?.includes('w-');
  const hasExplicitHeight = className?.includes('h-');
  const dimensionStyle = {
    width: hasExplicitWidth ? undefined : size,
    height: hasExplicitHeight ? undefined : size,
  };

  if (!url || !url.trim() || isFailed) {
    const iconSize = Math.max(14, Math.min(Math.round(size * 0.35), 48));
    return (
      <div
        className={cn('bg-[--surface-elevated] flex items-center justify-center text-[--muted] flex-shrink-0', className)}
        style={dimensionStyle}
        aria-label={alt}
      >
        <Music2 style={{ width: iconSize, height: iconSize }} />
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
      onError={() => setFailedUrl(url)}
      className={cn('object-cover flex-shrink-0', className)}
      style={dimensionStyle}
    />
  );
}
