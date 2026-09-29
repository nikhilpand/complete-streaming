'use client';

import { useEffect, useRef } from 'react';

/**
 * useOverlayHistory
 * Binds an overlay, sheet, or modal's open state to the browser history stack.
 *
 * Solves:
 * 1. "Page over page" bug: Pressing the browser's Back button/gesture closes the overlay
 *    in-place instead of navigating away the underlying page.
 * 2. Clean history: Closing via UI button (X, Esc, Backdrop) cleans up the pushed history entry
 *    so the browser Back button remains accurate.
 */
export function useOverlayHistory(
  isOpen: boolean,
  onClose: () => void,
  overlayKey: string
) {
  const isPushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!isOpen) {
      isPushedRef.current = false;
      return;
    }

    // 1. Push overlay marker into history
    isPushedRef.current = true;
    try {
      const currentState = window.history.state || {};
      window.history.pushState({ ...currentState, __swayOverlay: overlayKey }, '');
    } catch {
      // Fallback if pushState restricted
    }

    // 2. Listen for browser Back/Forward (popstate)
    const handlePopState = () => {
      if (isPushedRef.current) {
        isPushedRef.current = false;
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);

    // 3. Cleanup: If closed from UI while our overlay state is at top of stack, pop it
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (isPushedRef.current && window.history.state?.__swayOverlay === overlayKey) {
        isPushedRef.current = false;
        try {
          window.history.back();
        } catch {
          // Fallback
        }
      }
    };
  }, [isOpen, overlayKey]);
}
