import { fetchApi } from './client';
import type { Song, MediaResolution } from './types';

/**
 * The backend accepts only the raw provider_id (e.g. "yXCLyL-9"),
 * NOT the compound id (e.g. "saavn:yXCLyL-9").
 * Strip the "provider:" prefix if present.
 */
function songApiPath(id: string): string {
  if (id.startsWith('youtube:') || id.startsWith('yt:') || id.startsWith('spotify:')) {
    return id;
  }
  const colon = id.indexOf(':');
  return colon !== -1 ? id.slice(colon + 1) : id;
}

export async function getSong(id: string, signal?: AbortSignal) {
  return fetchApi<Song>(`/songs/${songApiPath(id)}`, { signal });
}

interface CachedMedia {
  data: MediaResolution;
  expiresAt: number;
}

const mediaCache = new Map<string, CachedMedia>();
const pendingResolutions = new Map<string, Promise<MediaResolution>>();
const MEDIA_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes

/**
 * Normalizes stream URLs to ensure CORS compatibility with HTML5 Audio and WebAudio API.
 * Google Video / YouTube streaming URLs lack CORS headers (Access-Control-Allow-Origin),
 * so in the browser they are routed through the Next.js /api/proxy/stream endpoint.
 * JioSaavn streams (aac.saavncdn.com) already send Access-Control-Allow-Origin: * and stream directly.
 */
export function getPlayableStreamUrl(url: string): string {
  if (!url) return '';
  if (typeof window !== 'undefined') {
    if (url.includes('googlevideo.com') || url.includes('youtube.com')) {
      return `/api/proxy/stream?url=${encodeURIComponent(url)}`;
    }
  }
  return url;
}

export async function resolveMedia(
  id: string,
  signal?: AbortSignal,
  meta?: { title?: string; artist?: string }
): Promise<MediaResolution> {
  const cleanId = songApiPath(id);
  const now = Date.now();
  const cached = mediaCache.get(cleanId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  // Deduplicate concurrent inflight requests for the exact same track
  const pending = pendingResolutions.get(cleanId);
  if (pending) {
    return pending;
  }

  const queryParams = new URLSearchParams();
  if (meta?.title) queryParams.set('title', meta.title);
  if (meta?.artist) queryParams.set('artist', meta.artist);
  const qs = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const promise = fetchApi<MediaResolution>(`/songs/${cleanId}/media${qs}`, { signal })
    .then((res) => {
      if (res && res.streams && res.streams.length > 0) {
        const normalized: MediaResolution = {
          ...res,
          streams: res.streams.map((s) => ({
            ...s,
            url: getPlayableStreamUrl(s.url),
          })),
        };
        mediaCache.set(cleanId, {
          data: normalized,
          expiresAt: Date.now() + MEDIA_CACHE_TTL_MS,
        });
        return normalized;
      }
      return res;
    })
    .finally(() => {
      pendingResolutions.delete(cleanId);
    });

  pendingResolutions.set(cleanId, promise);
  return promise;
}

export function prefetchMedia(id: string, meta?: { title?: string; artist?: string }): void {
  if (!id) return;
  const cleanId = songApiPath(id);
  const cached = mediaCache.get(cleanId);
  if (cached && cached.expiresAt > Date.now()) return;
  if (pendingResolutions.has(cleanId)) return;

  // Background fetch without blocking
  resolveMedia(id, undefined, meta).catch(() => {});
}

export async function getSongLyrics(id: string, signal?: AbortSignal) {
  return fetchApi<any>(`/songs/${songApiPath(id)}/lyrics`, { signal });
}
