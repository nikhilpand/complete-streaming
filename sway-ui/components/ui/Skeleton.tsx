import { cn } from '@/lib/utils';
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-white/[0.07] border border-white/[0.04] rounded-[--radius-sm]', className)} />;
}
