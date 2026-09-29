'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

const SHORTCUTS = [
  { key: 'Space / K', description: 'Play / Pause' },
  { key: '← / J', description: 'Seek back 5 seconds' },
  { key: '→ / L', description: 'Seek forward 5 seconds' },
  { key: 'Shift ←', description: 'Previous track' },
  { key: 'Shift →', description: 'Next track' },
  { key: '↑ / ↓', description: 'Volume +5% / -5%' },
  { key: 'M', description: 'Toggle mute' },
  { key: 'S', description: 'Toggle shuffle' },
  { key: 'R', description: 'Cycle repeat mode' },
  { key: 'F', description: 'Fullscreen lyrics' },
  { key: '/', description: 'Open search' },
  { key: '?', description: 'Show this help' },
];

export function ShortcutsModal() {
  const isOpen = usePlayerStore((s) => s.isShortcutsOpen);
  const toggleShortcuts = usePlayerStore((s) => s.toggleShortcuts);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="shortcuts-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={toggleShortcuts}
          />

          {/* Panel */}
          <motion.div
            key="shortcuts-panel"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-sm mx-4 rounded-[--radius-xl] bg-[--surface] border border-white/[0.08] shadow-2xl overflow-hidden"
              role="dialog"
              aria-label="Keyboard shortcuts"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <div>
                  <p className="text-sm font-semibold text-[--foreground] tracking-tight">
                    Keyboard Shortcuts
                  </p>
                  <p className="text-xs text-[--muted] mt-0.5">
                    Press <kbd className="font-mono bg-white/10 px-1 rounded text-[10px]">?</kbd> to toggle
                  </p>
                </div>
                <button
                  onClick={toggleShortcuts}
                  className="w-7 h-7 rounded-[--radius-sm] flex items-center justify-center text-[--muted] hover:text-[--foreground] hover:bg-white/10 transition-colors"
                  aria-label="Close shortcuts"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Shortcut list */}
              <div className="px-3 py-3 space-y-0.5 max-h-[60vh] overflow-y-auto">
                {SHORTCUTS.map(({ key, description }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between px-2 py-2 rounded-[--radius-sm] hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="text-xs text-[--muted]">{description}</span>
                    <kbd className="font-mono text-[10px] bg-white/10 text-[--foreground] px-2 py-0.5 rounded-[4px] border border-white/10 whitespace-nowrap">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-white/[0.06]">
                <p className="text-[10px] text-[--muted] text-center">
                  Shortcuts disabled when typing in an input field
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
