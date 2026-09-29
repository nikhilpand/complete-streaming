import { fetchApi } from './client';
import { getIdentityHeaders, getAnonymousId } from './telemetry';
import type {
  QuickPicksResponse,
  RadioResponse,
  RecommendationTrack,
  RelatedResponse,
  Song,
  UserTasteProfile,
} from './types';

export function recommendationToSong(rec: RecommendationTrack | any): Song {
  const artwork = rec.artwork_url || rec.image;
  const artistsList = Array.isArray(rec.artists)
    ? rec.artists.map((a: any) => (typeof a === 'string' ? { id: '', name: a, role: 'primary' } : a))
    : [{ id: '', name: rec.artist || rec.artist_name || 'Unknown Artist', role: 'primary' }];
  const id = rec.saavn_id || rec.id || '';
  const isYt = id.startsWith('youtube:') || id.startsWith('yt:');

  return {
    id,
    provider: isYt ? 'youtube' : 'saavn',
    provider_id: id.replace(/^(saavn|youtube):/, ''),
    type: 'song',
    title: rec.title || '',
    subtitle: rec.badge ? `${rec.badge} · ${rec.artist || ''}` : (rec.artist || rec.artist_name || ''),
    artists: artistsList,
    album: rec.album,
    artwork_url: artwork,
    duration_ms: rec.duration ? rec.duration * 1000 : rec.duration_ms,
    has_media: true,
  };
}

export async function getRadio(
  trackId: string,
  options?: {
    limit?: number;
    chipId?: string;
    chipPlaylistId?: string;
    chipParams?: string;
    title?: string;
    artist?: string;
    sessionId?: string;
    signal?: AbortSignal;
  }
): Promise<RadioResponse | null> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const cleanId = trackId.replace(/^saavn:/, '');
  const params = new URLSearchParams({
    track_id: cleanId,
    limit: Math.max(1, Math.min(50, options?.limit ?? 25)).toString(),
  });
  if (options?.chipId) params.set('chip_id', options.chipId);
  if (options?.chipPlaylistId) params.set('chip_playlist_id', options.chipPlaylistId);
  if (options?.chipParams) params.set('chip_params', options.chipParams);
  if (options?.title) params.set('title', options.title);
  if (options?.artist) params.set('artist', options.artist);
  if (options?.sessionId) params.set('session_id', options.sessionId);

  try {
    return await fetchApi<RadioResponse>(`/recommendations/radio?${params.toString()}`, {
      headers,
      signal: options?.signal,
    });
  } catch {
    return null;
  }
}

export async function getQuickPicks(options?: {
  recent?: string[];
  limit?: number;
  signal?: AbortSignal;
}): Promise<RecommendationTrack[]> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const params = new URLSearchParams({
    limit: Math.max(1, Math.min(30, options?.limit ?? 12)).toString(),
  });
  if (options?.recent?.length) {
    params.set('recent', options.recent.map((id) => id.replace(/^saavn:/, '')).join(','));
  }

  try {
    const res = await fetchApi<QuickPicksResponse>(`/recommendations/quick-picks?${params.toString()}`, {
      headers,
      signal: options?.signal,
    });
    return res?.quick_picks || [];
  } catch {
    return [];
  }
}

export async function getRelated(
  trackId: string,
  signal?: AbortSignal
): Promise<RelatedResponse | null> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  const cleanId = trackId.replace(/^saavn:/, '');
  try {
    return await fetchApi<RelatedResponse>(
      `/recommendations/related?track_id=${encodeURIComponent(cleanId)}`,
      { headers, signal }
    );
  } catch {
    return null;
  }
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
  if (options.currentTrackId) params.set('current_track_id', options.currentTrackId.replace(/^saavn:/, ''));
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
  const cleanId = trackId.replace(/^saavn:/, '');

  // 1. Try unified YTM + Saavn + graph radio first
  try {
    const res = await getRadio(cleanId, { limit: n, signal });
    if (res?.tracks && res.tracks.length > 0) {
      return res.tracks;
    }
  } catch {}

  // 2. Fallback: Legacy similar endpoint
  try {
    const res = await fetchApi<RecommendationTrack[]>(
      `/tracks/${encodeURIComponent(cleanId)}/similar?n=${n}`,
      { headers, signal }
    );
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
