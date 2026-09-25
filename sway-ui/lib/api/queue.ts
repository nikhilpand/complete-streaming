import { fetchApi } from './client';
import { getIdentityHeaders } from './telemetry';
import type { QueueNextResponse, QueueTrack, Song } from './types';

export function queueTrackToSong(t: QueueTrack): Song {
  return {
    id: t.id,
    provider: t.id.startsWith('youtube:') || t.id.startsWith('yt:') ? 'youtube' : 'saavn',
    provider_id: t.id.replace(/^(saavn|youtube):/, ''),
    type: 'song',
    title: t.title,
    subtitle: t.artist_name || (t.artists && t.artists[0]?.name) || '',
    artists: t.artists || [{ id: '', name: t.artist_name || 'Unknown Artist', role: 'primary' }],
    album: t.album,
    artwork_url: t.artwork_url,
    year: t.year,
    language: t.language,
    has_media: true,
  };
}

export async function getNextQueue(
  currentTrackId: string,
  count: number = 10,
  signal?: AbortSignal
): Promise<QueueTrack[]> {
  if (!currentTrackId) return [];
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const params = new URLSearchParams({
    current_track_id: currentTrackId,
    count: Math.max(1, Math.min(50, count)).toString(),
  });

  try {
    const res = await fetchApi<QueueNextResponse>(`/queue/next?${params.toString()}`, {
      headers,
      signal,
    });
    return res?.queue || [];
  } catch {
    return [];
  }
}
