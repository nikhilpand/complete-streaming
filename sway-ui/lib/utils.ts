import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSecs(s: number): string {
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function artistNames(artists?: { name: string }[], subtitle?: string): string {
  const fromList = artists?.map((a) => a.name).filter(Boolean).join(', ');
  if (fromList) {
    if (fromList.includes('·') || fromList.includes('•')) {
      const parts = fromList.split(/\s*[·•|]\s*/).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 1];
    }
    return fromList;
  }
  if (subtitle) {
    const parts = subtitle.split(/\s*[·•|]\s*/).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
    if (parts.length === 1) return parts[0];
  }
  return 'Unknown Artist';
}

export function artUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/\b(50x50|150x150)\b/g, '500x500');
}

export function getSavedVolume(defaultVal = 0.8): number {
  if (typeof window === 'undefined') return defaultVal;
  try {
    const raw = localStorage.getItem('sway_volume');
    if (raw === null) return defaultVal;
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  } catch {}
  return defaultVal;
}

export function getSavedMuted(defaultVal = false): boolean {
  if (typeof window === 'undefined') return defaultVal;
  try {
    const raw = localStorage.getItem('sway_muted');
    if (raw === null) return defaultVal;
    return raw === 'true';
  } catch {}
  return defaultVal;
}

export function searchItemToSong(item: {
  id: string;
  provider: string;
  provider_id: string;
  title: string;
  subtitle?: string;
  artwork_url?: string;
  extra?: { album?: string; duration_ms?: number; is_explicit?: boolean };
  perma_url?: string;
}) {
  let artists: { id: string; name: string; role: string }[] = [];
  let albumName: string | undefined;

  if (item.provider === 'youtube') {
    artists = (item.subtitle || 'YouTube Music')
      .split(',')
      .map((name) => ({ id: '', name: name.trim(), role: 'primary' }))
      .filter((a) => a.name.length > 0);
    albumName = item.extra?.album;
  } else {
    const parts = (item.subtitle || '').split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
    const artistName = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
    artists = [{ id: '', name: artistName, role: 'primary' }];
    albumName = parts.length > 1 ? parts.slice(0, -1).join(' · ') : undefined;
  }

  return {
    id: item.id,
    provider: item.provider,
    provider_id: item.provider_id,
    type: 'song' as const,
    title: item.title,
    subtitle: item.subtitle,
    artists: artists.length > 0 ? artists : [{ id: '', name: 'Artist', role: 'primary' }],
    album: albumName,
    duration_ms: item.extra?.duration_ms,
    artwork_url: item.artwork_url,
    is_explicit: Boolean(item.extra?.is_explicit),
    has_media: true,
  };
}

