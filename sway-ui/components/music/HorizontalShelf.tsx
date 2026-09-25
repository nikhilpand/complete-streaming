import { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function HorizontalShelf({ title, subtitle, children }: Props) {
  return (
    <section className="space-y-4">
      <div className="px-1">
        <h2 className="text-lg font-semibold text-[--foreground] tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-[--muted] mt-0.5">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {children}
      </div>
    </section>
  );
}
