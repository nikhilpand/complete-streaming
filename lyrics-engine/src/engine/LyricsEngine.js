/**
 * LyricsEngine.js - Master Cascading Lyrics Orchestrator
 * High-performance, multi-provider lyrics engine with intelligent fallback,
 * persistent caching, offset fine-tuning, and sub-millisecond timeline tracking.
 */

import { StorageCache } from './StorageCache.js';
import { ProviderLRCLIB } from './providers/ProviderLRCLIB.js';
import { ProviderMusixmatch } from './providers/ProviderMusixmatch.js';
import { ProviderNetease } from './providers/ProviderNetease.js';
import { ProviderGenius } from './providers/ProviderGenius.js';

export class LyricsEngine {
  constructor(options = {}) {
    this.cache = new StorageCache();
    this.providers = [
      ProviderLRCLIB,
      ProviderMusixmatch,
      ProviderNetease,
      ProviderGenius
    ];

    this.currentTrack = null;
    this.currentLyrics = null;
    this.currentTimeMs = 0;
    this.activeLineIndex = -1;
    this.offsetMs = this.loadOffset();

    this.listeners = new Map();
    this.isLoading = false;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(...args);
        } catch (e) {
          console.error(`Error in LyricsEngine listener for ${event}:`, e);
        }
      }
    }
  }

  loadOffset() {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('lyrics_time_offset');
      return saved ? parseInt(saved, 10) || 0 : 0;
    }
    return 0;
  }

  setOffset(offsetMs) {
    this.offsetMs = offsetMs;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lyrics_time_offset', offsetMs.toString());
    }
    this.emit('offsetChange', this.offsetMs);
    this.updateProgress(this.currentTimeMs, true);
  }

  async fetchLyrics(trackInfo, forceProvider = null) {
    if (!trackInfo || !trackInfo.title) return null;

    this.currentTrack = trackInfo;
    this.isLoading = true;
    this.emit('loading', trackInfo);

    const durationSec = trackInfo.duration ? Math.round(trackInfo.duration / (trackInfo.duration > 1000 ? 1000 : 1)) : 0;

    if (!forceProvider) {
      const cached = await this.cache.get(trackInfo.title, trackInfo.artist, durationSec);
      if (cached) {
        this.currentLyrics = cached;
        this.isLoading = false;
        this.activeLineIndex = -1;
        this.emit('lyricsLoaded', cached);
        return cached;
      }
    }

    const providersToTry = forceProvider
      ? this.providers.filter(p => (p.id || p.name || '').toLowerCase() === forceProvider.toLowerCase())
      : this.providers;

    let result = null;

    for (const provider of providersToTry) {
      try {
        result = await provider.getLyrics(trackInfo);
        if (result && result.lines && result.lines.length > 0) {
          break;
        }
      } catch (e) {
        console.warn(`Provider ${provider.id || provider.name} failed:`, e);
      }
    }

    this.isLoading = false;

    if (result && result.lines && result.lines.length > 0) {
      this.currentLyrics = result;
      this.activeLineIndex = -1;
      await this.cache.set(trackInfo.title, trackInfo.artist, durationSec, result);
      this.emit('lyricsLoaded', result);
      return result;
    } else {
      this.currentLyrics = null;
      this.activeLineIndex = -1;
      this.emit('error', new Error('No lyrics found from any provider'));
      return null;
    }
  }

  updateProgress(timeMs, force = false) {
    this.currentTimeMs = timeMs;
    const adjustedTime = Math.max(0, timeMs + this.offsetMs);

    if (!this.currentLyrics || !this.currentLyrics.isSynced || !this.currentLyrics.lines.length) {
      return;
    }

    const lines = this.currentLyrics.lines;

    let newIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (adjustedTime >= lines[i].time) {
        newIndex = i;
      } else {
        break;
      }
    }

    this.emit('progress', {
      timeMs: adjustedTime,
      activeLineIndex: newIndex,
      activeLine: lines[newIndex] || null
    });

    if (newIndex !== this.activeLineIndex || force) {
      this.activeLineIndex = newIndex;
      this.emit('lineChange', {
        index: newIndex,
        line: lines[newIndex] || null,
        adjustedTime
      });
    }
  }
}
