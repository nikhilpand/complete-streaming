import { fetchApi } from './client';
import type { Song, MediaResolution } from './types';

/**
 * The backend accepts only the raw provider_id (e.g. "yXCLyL-9"),
 * NOT the compound id (e.g. "saavn:yXCLyL-9").
 * Strip the "provider:" prefix if present.
 */
function rawId(id: string): string {
  const colon = id.indexOf(':');
  return colon !== -1 ? id.slice(colon + 1) : id;
}

export async function getSong(id: string, signal?: AbortSignal) {
  return fetchApi<Song>(`/songs/${rawId(id)}`, { signal });
}

export async function resolveMedia(id: string, signal?: AbortSignal) {
  return fetchApi<MediaResolution>(`/songs/${rawId(id)}/media`, { signal });
}

export async function getSongLyrics(id: string, signal?: AbortSignal) {
  return fetchApi<any>(`/songs/${rawId(id)}/lyrics`, { signal });
}
