import { fetchApi } from './client';
import { getIdentityHeaders } from './telemetry';
import type { Song } from './types';

export interface HomeShelfData {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  badge: string;
  reason?: string;
  items: Song[];
}

export interface HomeFeedData {
  user_id: string;
  state: 'cold' | 'seeded' | 'learning' | 'personalized';
  shelves: HomeShelfData[];
}

export async function getHomeFeed(signal?: AbortSignal): Promise<HomeFeedData> {
  const headers = typeof window !== 'undefined' ? getIdentityHeaders() : {};
  return fetchApi<HomeFeedData>('/recommendations/home', {
    headers,
    signal,
  });
}
