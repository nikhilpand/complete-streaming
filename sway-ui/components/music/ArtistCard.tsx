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
      <div className="relative aspect-square overflow-hidden rounded-full w-full bg-[--surface-elevated] ring-1 ring-white/10 group-hover:ring-[--art-primary]/50 transition-all duration-[--motion-normal] group-hover:scale-[1.03]">
        <Artwork src={artwork_url} alt={name} size={160} className="w-full h-full rounded-full object-cover" />
      </div>
      <p className="text-[13px] font-medium text-[--foreground] truncate mt-3">{name}</p>
      <p className="text-[11px] text-[--muted]">Artist</p>
    </Link>
  );
}
