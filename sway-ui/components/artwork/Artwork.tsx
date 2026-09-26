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
  const [useFallback, setUseFallback] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);

  // Reset fallback state when src changes
  if (src !== lastSrc) {
    setLastSrc(src);
    setUseFallback(false);
    setFailedUrl(null);
  }

  const upgradedUrl = src ? artUrl(src) : '';
  const activeUrl = useFallback && src ? src : upgradedUrl;
  const isFailed = Boolean(!activeUrl || !activeUrl.trim() || failedUrl === activeUrl);

  const hasExplicitWidth = className?.includes('w-');
  const hasExplicitHeight = className?.includes('h-');
  const dimensionStyle = {
    width: hasExplicitWidth ? undefined : size,
    height: hasExplicitHeight ? undefined : size,
  };

  if (isFailed) {
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
      src={activeUrl}
      alt={alt}
      width={size}
      height={size}
      onError={() => {
        if (!useFallback && src && src !== upgradedUrl) {
          setUseFallback(true);
        } else {
          setFailedUrl(activeUrl);
        }
      }}
      className={cn('object-cover flex-shrink-0', className)}
      style={dimensionStyle}
    />
  );
}
