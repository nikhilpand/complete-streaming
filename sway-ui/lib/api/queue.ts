import { fetchApi } from './client';
import { getIdentityHeaders } from './telemetry';
import type { QueueNextResponse, QueueTrack, Song } from './types';

export function queueTrackToSong(t: QueueTrack | any): Song {
  const rawId = t.saavn_id || t.id || '';
  const isYt = rawId.startsWith('youtube:') || rawId.startsWith('yt:');
  const artistsList = Array.isArray(t.artists)
    ? t.artists.map((a: any) => (typeof a === 'string' ? { id: '', name: a, role: 'primary' } : a))
    : [{ id: '', name: t.artist_name || t.artist || 'Unknown Artist', role: 'primary' }];

  return {
    id: rawId,
    provider: isYt ? 'youtube' : 'saavn',
    provider_id: rawId.replace(/^(saavn|youtube):/, ''),
    type: 'song',
    title: t.title,
    subtitle: t.artist_name || (t.artists && t.artists[0]?.name) || t.artist || '',
    artists: artistsList,
    album: t.album,
    artwork_url: t.artwork_url || t.image,
    year: t.year,
    language: t.language,
    duration_ms: t.duration ? t.duration * 1000 : t.duration_ms,
    has_media: true,
  };
}

export async function getNextQueue(
  currentTrackId: string,
  count: number = 10,
  signal?: AbortSignal,
  sessionId?: string
): Promise<QueueTrack[]> {
  if (!currentTrackId) return [];
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const params = new URLSearchParams({
    current_track_id: currentTrackId.replace(/^saavn:/, ''),
    count: Math.max(1, Math.min(50, count)).toString(),
  });
  if (sessionId) params.set('session_id', sessionId);

  try {
    const res = await fetchApi<QueueNextResponse>(`/queue/next?${params.toString()}`, {
      headers,
      signal,
    });
    return res?.queue || res?.tracks || [];
  } catch {
    return [];
  }
}
