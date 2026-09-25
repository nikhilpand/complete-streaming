'use client';
import Link from 'next/link';
import { Artwork } from '@/components/artwork/Artwork';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  name: string;
  artwork_url?: string;
  className?: string;
}

export function ArtistCard({ id, name, artwork_url, className }: Props) {
  return (
    <Link href={`/artist/${id}`} className={cn('group block text-center cursor-pointer', className)}>
      <div className="relative aspect-square overflow-hidden rounded-full bg-[--surface-elevated] mb-3 transition-transform duration-[--motion-normal] group-hover:scale-105">
        <Artwork src={artwork_url} alt={name} size={160} className="w-full h-full rounded-full" />
      </div>
      <p className="text-sm font-medium text-[--foreground] truncate">{name}</p>
      <p className="text-xs text-[--muted]">Artist</p>
    </Link>
  );
}
