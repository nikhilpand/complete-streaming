import { fetchApi } from './client';
import { getIdentityHeaders, getAnonymousId } from './telemetry';
import type { RecommendationTrack, Song, UserTasteProfile } from './types';

export function recommendationToSong(rec: RecommendationTrack): Song {
  return {
    id: rec.id,
    provider: rec.id.startsWith('youtube:') || rec.id.startsWith('yt:') ? 'youtube' : 'saavn',
    provider_id: rec.id.replace(/^(saavn|youtube):/, ''),
    type: 'song',
    title: rec.title,
    subtitle: rec.badge ? `${rec.badge} · ${rec.artist}` : rec.artist,
    artists: [{ id: '', name: rec.artist || 'Unknown Artist', role: 'primary' }],
    album: rec.album,
    artwork_url: rec.artwork_url,
    has_media: true,
  };
}

export async function getRecommendations(options: {
  currentTrackId?: string;
  feedType?: 'for_you' | 'track_radio' | 'discover' | 'autoplay';
  n?: number;
  userId?: string;
  signal?: AbortSignal;
}): Promise<RecommendationTrack[]> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const params = new URLSearchParams();
  if (options.currentTrackId) params.set('current_track_id', options.currentTrackId);
  if (options.feedType) params.set('feed_type', options.feedType);
  if (options.n) params.set('n', Math.max(1, Math.min(50, options.n)).toString());
  if (options.userId) params.set('user_id', options.userId);

  try {
    const res = await fetchApi<RecommendationTrack[]>(`/recommendations?${params.toString()}`, {
      headers,
      signal: options.signal,
    });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export async function getTrackRadio(
  trackId: string,
  n: number = 10,
  signal?: AbortSignal
): Promise<RecommendationTrack[]> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  try {
    const res = await fetchApi<RecommendationTrack[]>(`/tracks/${encodeURIComponent(trackId)}/similar?n=${n}`, {
      headers,
      signal,
    });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export async function getUserTaste(
  userId?: string,
  signal?: AbortSignal
): Promise<UserTasteProfile | null> {
  const uid =
    userId ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('sway_account_id') || getAnonymousId()
      : 'guest_user');
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  try {
    return await fetchApi<UserTasteProfile>(`/users/${encodeURIComponent(uid)}/taste`, {
      headers,
      signal,
    });
  } catch {
    return null;
  }
}

export async function getUserSettings(
  userId?: string,
  signal?: AbortSignal
): Promise<Record<string, any>> {
  const uid =
    userId ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('sway_account_id') || getAnonymousId()
      : 'guest_user');
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  try {
    const res = await fetchApi<{ settings: Record<string, any> }>(
      `/users/${encodeURIComponent(uid)}/settings`,
      { headers, signal }
    );
    return res?.settings || {};
  } catch {
    return {};
  }
}

export async function updateUserSettings(
  settings: Record<string, any>,
  userId: string = 'guest_user'
): Promise<boolean> {
  try {
    const res = await fetch(`/api/proxy/users/${encodeURIComponent(userId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
