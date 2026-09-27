'use client';

import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center space-y-4">
          <div className="p-3 rounded-full bg-red-500/10 text-rose-400 border border-red-500/20">
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-[--foreground]">Something went wrong</h3>
            <p className="text-xs text-[--muted] mt-1 max-w-sm">
              An unexpected error occurred in the player interface.
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="px-4 py-2 text-xs font-semibold rounded-[--radius-md] bg-[--foreground] text-[--surface] hover:opacity-90 transition-opacity cursor-pointer"
          >
            Reload player
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
