'use client';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { Artwork } from '@/components/artwork/Artwork';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  artwork_url?: string;
  className?: string;
}

export function AlbumCard({ id, title, subtitle, artwork_url, className }: Props) {
  return (
    <Link href={`/album/${id}`} className={cn('group block cursor-pointer', className)}>
      <div className="relative aspect-square overflow-hidden rounded-[--radius-lg] bg-[--surface-elevated] mb-3">
        <Artwork src={artwork_url} alt={title} size={200} className="w-full h-full rounded-[--radius-lg] transition-transform duration-[--motion-slow] group-hover:scale-105" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-[--motion-normal] rounded-[--radius-lg]" />
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-all duration-[--motion-normal] translate-y-2 group-hover:translate-y-0">
          <div className="w-10 h-10 rounded-full bg-[--foreground] flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 text-[--surface] fill-current translate-x-0.5" />
          </div>
        </div>
      </div>
      <p className="text-sm font-medium text-[--foreground] truncate leading-tight">{title}</p>
      {subtitle && <p className="text-xs text-[--muted] truncate mt-0.5">{subtitle}</p>}
    </Link>
  );
}
