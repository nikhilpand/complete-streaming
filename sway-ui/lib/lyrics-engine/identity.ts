/**
 * identity.ts
 * Canonical Track Identity and Version Extraction
 */

import { TrackIdentity, TrackVersion } from './types';

export function detectTrackVersion(rawTitle: string, rawAlbum: string = ''): TrackVersion {
  const combined = `${rawTitle} ${rawAlbum}`.toLowerCase();

  if (/\b(?:karaoke|backing track)\b/.test(combined)) return 'karaoke';
  if (/\b(?:instrumental|backing version)\b/.test(combined)) return 'instrumental';
  if (/\b(?:live(?:\s+at|\s+in|\s+version)?|in concert|unplugged)\b/.test(combined)) return 'live';
  if (/\b(?:remix|club mix|dance mix|dub mix|extended mix|lofi flip|re-fix)\b/.test(combined)) return 'remix';
  if (/\b(?:acoustic|stripped|piano version|orchestral)\b/.test(combined)) return 'acoustic';
  if (/\b(?:slowed(?:\s*\+\s*reverb)?)\b/.test(combined)) return 'slowed';
  if (/\b(?:sped\s*up|speed\s*up|nightcore)\b/.test(combined)) return 'sped-up';
  if (/\b(?:cover|tribute)\b/.test(combined)) return 'cover';
  if (/\b(?:radio edit|single edit)\b/.test(combined)) return 'radio-edit';
  if (/\b(?:from\s+["'][^"']+["']|soundtrack version|film version|original motion picture)\b/.test(combined)) {
    return 'movie-version';
  }

  return 'original';
}

function fastHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function createTrackIdentity(raw: {
  title: string;
  artist?: string;
  artists?: string[];
  album?: string;
  subtitle?: string;
  durationMs?: number;
  duration?: number; // seconds
  videoId?: string;
  isrc?: string;
  providerId?: string;
  providerTrackId?: string;
}): TrackIdentity {
  const title = (raw.title || '').trim();

  // Normalize artists list
  let artists: string[] = [];
  if (Array.isArray(raw.artists) && raw.artists.length > 0) {
    artists = raw.artists.map((a) => a.trim()).filter(Boolean);
  } else if (raw.artist && raw.artist !== 'Unknown Artist') {
    artists = raw.artist
      .split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i)
      .map((a) => a.trim())
      .filter(Boolean);
  } else if (raw.subtitle) {
    const parts = raw.subtitle.split('·').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      artists = parts[1].split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i).map((a) => a.trim()).filter(Boolean);
    } else if (parts.length === 1) {
      artists = [parts[0]];
    }
  }

  if (artists.length === 0) {
    artists = ['Unknown Artist'];
  }

  const album = (raw.album || (raw.subtitle?.split('·')[0]?.trim()) || '').trim();
  const durationMs = raw.durationMs || (raw.duration ? Math.round(raw.duration * 1000) : 0);
  const version = detectTrackVersion(title, album);

  // 5-second duration bucket to prevent collisions while clustering identical recordings
  const durationBucket = durationMs > 0 ? Math.floor(durationMs / 5000) : 0;
  const normalizedKey = `${title.toLowerCase()}|${artists.map((a) => a.toLowerCase()).sort().join(',')}|${durationBucket}|${version}`;
  const identityHash = fastHash(normalizedKey);

  return {
    title,
    artists,
    album: album || undefined,
    durationMs,
    videoId: raw.videoId,
    isrc: raw.isrc,
    providerId: raw.providerId,
    providerTrackId: raw.providerTrackId,
    version,
    identityHash,
  };
}
