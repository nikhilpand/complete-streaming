import { AlertCircle, RefreshCw } from 'lucide-react';
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-[--muted]">
      <AlertCircle className="w-8 h-8" />
      <p className="text-sm text-center max-w-xs leading-relaxed">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 text-sm text-[--muted] hover:text-[--foreground] transition-colors mt-2">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      )}
    </div>
  );
}
