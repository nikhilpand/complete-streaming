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
    <Link href={`/album/${id}`} className={cn('group block cursor-pointer bg-[#111118] border border-white/[0.05] hover:border-white/[0.1] rounded-[--radius-lg] p-3 transition-all duration-[--motion-normal] hover:bg-white/[0.03]', className)}>
      <div className="relative aspect-square overflow-hidden rounded-[12px] bg-[--surface-elevated] mb-3">
        <Artwork src={artwork_url} alt={title} size={200} className="w-full h-full rounded-[12px] transition-transform duration-[--motion-slow] group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-[--motion-normal] rounded-[12px]" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-[--motion-normal] scale-95 group-hover:scale-100">
          <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 fill-current translate-x-0.5" />
          </div>
        </div>
      </div>
      <p className="text-[13px] font-medium text-[--foreground] truncate leading-tight">{title}</p>
      {subtitle && <p className="text-[11px] text-[--muted] truncate mt-0.5">{subtitle}</p>}
    </Link>
  );
}
