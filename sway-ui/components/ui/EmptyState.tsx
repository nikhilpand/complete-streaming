import { Music2 } from 'lucide-react';
import { ReactNode } from 'react';
export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-[--muted]">
      {icon || <Music2 className="w-8 h-8" />}
      <p className="text-sm font-medium text-[--foreground]">{title}</p>
      {description && <p className="text-xs text-center max-w-xs text-[--muted] leading-relaxed">{description}</p>}
    </div>
  );
}
