import { fetchApi } from './client';
import type { Playlist } from './types';

function rawId(id: string): string {
  const colon = id.indexOf(':');
  return colon !== -1 ? id.slice(colon + 1) : id;
}

export async function getPlaylist(id: string, signal?: AbortSignal) {
  return fetchApi<Playlist>(`/playlists/${rawId(id)}`, { signal });
}
