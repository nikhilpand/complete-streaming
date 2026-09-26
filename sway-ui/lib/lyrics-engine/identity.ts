/**
 * identity.ts
 * Canonical Recording Identity & High-Precision Recording Fingerprinting
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

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/**
 * Synchronous pure SHA-256 implementation conforming to FIPS 180-4.
 * Works uniformly in Node.js, Web Worker, and Browser contexts.
 */
export function sha256(str: string): string {
  const utf8 = unescape(encodeURIComponent(str));
  const words: number[] = [];
  const asciiBitLength = utf8.length * 8;
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << ((3 - (i % 4)) * 8);
  }
  words[utf8.length >> 2] |= 0x80 << ((3 - (utf8.length % 4)) * 8);
  words[(((utf8.length + 8) >> 6) << 4) + 15] = asciiBitLength;

  let hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const w = new Array(64);
  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 16; j++) w[j] = words[i + j] || 0;
    let [a, b, c, d, e, f, g, h] = hash;
    for (let j = 0; j < 64; j++) {
      if (j >= 16) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    hash = [(hash[0] + a)|0, (hash[1] + b)|0, (hash[2] + c)|0, (hash[3] + d)|0, (hash[4] + e)|0, (hash[5] + f)|0, (hash[6] + g)|0, (hash[7] + h)|0];
  }
  let res = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const byte = (hash[i] >> (j * 8)) & 255;
      res += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return res;
}

export function cleanTextForIdentity(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  provider?: string;
  providerId?: string;
  providerTrackId?: string;
}): TrackIdentity {
  const title = (raw.title || '').trim();

  // Normalize artists list
  let artists: string[] = [];
  const cleanPotentialSubtitle = (str: string): string => {
    if (str.includes('·') || str.includes('•') || str.includes('|')) {
      const parts = str.split(/\s*[·•|]\s*/).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 1];
    }
    return str;
  };

  if (Array.isArray(raw.artists) && raw.artists.length > 0) {
    artists = raw.artists
      .map((a) => cleanPotentialSubtitle(a.trim()))
      .filter(Boolean);
  } else if (raw.artist && raw.artist !== 'Unknown Artist') {
    const cleaned = cleanPotentialSubtitle(raw.artist);
    artists = cleaned
      .split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i)
      .map((a) => a.trim())
      .filter(Boolean);
  } else if (raw.subtitle) {
    const parts = raw.subtitle.split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      artists = parts[parts.length - 1].split(/[,&/|]|\sfeat\.\s*|\sft\.\s*/i).map((a) => a.trim()).filter(Boolean);
    } else if (parts.length === 1) {
      artists = [parts[0]];
    }
  }

  if (artists.length === 0) {
    artists = ['Unknown Artist'];
  }

  const album = (raw.album || (raw.subtitle?.split(/\s*[·•|]\s*/)[0]?.trim()) || '').trim();
  const durationMs = raw.durationMs || (raw.duration ? Math.round(raw.duration * 1000) : 0);
  const version = detectTrackVersion(title, album);

  // Exact 1-second precision bucket (replaces 5s bucket to prevent collision of different cuts)
  const exactDurationBucket = durationMs > 0 ? Math.floor(durationMs / 1000) : 0;

  // Resolve provider & providerTrackId with namespace safety
  let provider = (raw.provider || raw.providerId || '').toLowerCase().trim();
  let providerTrackId = (raw.providerTrackId || '').trim();
  let videoId = (raw.videoId || '').trim();

  if (providerTrackId.startsWith('youtube:')) {
    provider = 'youtube';
    providerTrackId = providerTrackId.slice('youtube:'.length);
    if (!videoId) videoId = providerTrackId;
  } else if (providerTrackId.startsWith('yt:')) {
    provider = 'youtube';
    providerTrackId = providerTrackId.slice('yt:'.length);
    if (!videoId) videoId = providerTrackId;
  } else if (providerTrackId.startsWith('saavn:')) {
    provider = 'saavn';
    providerTrackId = providerTrackId.slice('saavn:'.length);
  }

  if (!provider) {
    if (videoId) {
      provider = 'youtube';
    } else if (providerTrackId) {
      provider = 'saavn';
    } else {
      provider = 'unknown';
    }
  }

  if (provider === 'youtube' && !videoId && providerTrackId) {
    videoId = providerTrackId;
  }

  // Canonical compound track key
  let canonicalTrackKey = '';
  if (provider === 'youtube' && (providerTrackId || videoId)) {
    canonicalTrackKey = `youtube:${providerTrackId || videoId}`;
  } else if (provider !== 'unknown' && providerTrackId) {
    canonicalTrackKey = `${provider}:${providerTrackId}`;
  } else if (videoId) {
    canonicalTrackKey = `youtube:${videoId}`;
  } else if (providerTrackId) {
    canonicalTrackKey = providerTrackId;
  } else {
    canonicalTrackKey = `track:${cleanTextForIdentity(title)}`;
  }

  const isrc = (raw.isrc || '').trim().toUpperCase();
  const normalizedTitle = cleanTextForIdentity(title);
  const normalizedArtists = artists.map(cleanTextForIdentity).filter(Boolean);
  const normalizedAlbum = cleanTextForIdentity(album);

  // Canonical recording fingerprint (Section 1 P0 Invariant)
  // sha256(provider + providerTrackId + videoId + isrc + normalizedTitle + normalizedArtists + normalizedAlbum + exactDurationBucket + version)
  const sortedArtists = [...normalizedArtists].sort().join(',');
  const recordingPayload = [
    provider,
    providerTrackId,
    videoId,
    isrc,
    normalizedTitle,
    sortedArtists,
    normalizedAlbum,
    exactDurationBucket.toString(),
    version,
  ].join('|');

  const recordingKey = sha256(recordingPayload);
  const identityHash = recordingKey; // backward compatibility

  return {
    provider,
    providerId: provider,
    providerTrackId: providerTrackId || undefined,
    videoId: videoId || undefined,
    isrc: isrc || undefined,
    canonicalTrackKey,
    title,
    normalizedTitle,
    artists,
    normalizedArtists,
    album: album || undefined,
    normalizedAlbum: normalizedAlbum || undefined,
    durationMs,
    exactDurationBucket,
    version,
    recordingKey,
    identityHash,
  };
}
