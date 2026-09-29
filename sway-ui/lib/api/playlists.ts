import { fetchApi } from './client';
import type { Playlist } from './types';

function playlistApiPath(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith('spotify:') || trimmed.startsWith('youtube:') || trimmed.startsWith('yt:')) {
    return trimmed;
  }
  const colon = trimmed.indexOf(':');
  return colon !== -1 ? trimmed.slice(colon + 1) : trimmed;
}

export async function getPlaylist(id: string, signal?: AbortSignal) {
  return fetchApi<Playlist>(`/playlists/${playlistApiPath(id)}`, { signal });
}

export async function resolvePlaylistByUrl(url: string, signal?: AbortSignal) {
  return fetchApi<Playlist>(`/playlists?link=${encodeURIComponent(url.trim())}`, { signal });
}

export async function importPlaylist(url: string, signal?: AbortSignal) {
  return fetchApi<Playlist>(`/playlists/import`, {
    method: 'POST',
    body: JSON.stringify({ url: url.trim() }),
    signal,
  });
}
