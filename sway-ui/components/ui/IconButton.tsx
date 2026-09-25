'use client';
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  sz?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'filled' | 'prominent';
}

export const IconButton = forwardRef<HTMLButtonElement, Props>((
  { sz = 'md', variant = 'ghost', className, children, ...rest }, ref
) => {
  const sizes = { sm: 'w-8 h-8 rounded-[--radius-sm]', md: 'w-10 h-10 rounded-[--radius-md]', lg: 'w-12 h-12 rounded-[--radius-lg]' };
  const variants = {
    ghost: 'text-[--muted] hover:text-[--foreground] hover:bg-[--surface-elevated] transition-colors',
    filled: 'bg-[--surface-elevated] text-[--foreground] hover:bg-[--surface-elevated-hover] transition-colors',
    prominent: 'bg-[--foreground] text-[--surface] hover:opacity-90 transition-opacity',
  };
  return (
    <button
      ref={ref}
      className={cn('inline-flex items-center justify-center flex-shrink-0 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40 disabled:pointer-events-none', sizes[sz], variants[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
});
IconButton.displayName = 'IconButton';
