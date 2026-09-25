import { fetchApi } from './client';
import type { Album } from './types';

function rawId(id: string): string {
  const colon = id.indexOf(':');
  return colon !== -1 ? id.slice(colon + 1) : id;
}

export async function getAlbum(id: string, signal?: AbortSignal) {
  return fetchApi<Album>(`/albums/${rawId(id)}`, { signal });
}
