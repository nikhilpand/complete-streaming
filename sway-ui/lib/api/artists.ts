import { fetchApi } from './client';
import type { Artist, Song, Album } from './types';

function rawId(id: string): string {
  const colon = id.indexOf(':');
  return colon !== -1 ? id.slice(colon + 1) : id;
}

export async function getArtist(id: string, signal?: AbortSignal) {
  return fetchApi<Artist>(`/artists/${rawId(id)}`, { signal });
}
export async function getArtistSongs(id: string, page = 1, n = 50, signal?: AbortSignal) {
  return fetchApi<Song[]>(`/artists/${rawId(id)}/songs?page=${page}&n=${n}`, { signal });
}
export async function getArtistAlbums(id: string, page = 1, n = 50, signal?: AbortSignal) {
  return fetchApi<Album[]>(`/artists/${rawId(id)}/albums?page=${page}&n=${n}`, { signal });
}
