/**
 * Karaoke API client — all calls go through /api/proxy.
 */

import type { KaraokeInfo } from './types';

const PROXY = '/api/proxy';

function buildUrl(trackId: string, suffix = ''): string {
  return `${PROXY}/karaoke/${encodeURIComponent(trackId)}${suffix}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'HTTP error' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!body.success) {
    throw new Error(body.error || 'API error');
  }
  return body.data as T;
}

export async function getKaraokeStatus(trackId: string): Promise<KaraokeInfo> {
  return fetchJson<KaraokeInfo>(buildUrl(trackId));
}

export async function prepareKaraoke(
  trackId: string,
  streamUrl: string,
  canonicalTrackKey?: string,
): Promise<KaraokeInfo> {
  return fetchJson<KaraokeInfo>(buildUrl(trackId, '/prepare'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_url: streamUrl,
      canonical_track_key: canonicalTrackKey,
    }),
  });
}

export async function pollKaraokeStatus(trackId: string): Promise<KaraokeInfo> {
  return fetchJson<KaraokeInfo>(buildUrl(trackId, '/status'));
}

export function getStemStreamUrl(trackId: string, stem: 'vocals' | 'instrumental'): string {
  return `/api/proxy/karaoke/${encodeURIComponent(trackId)}/stream/${stem}?v=2`;
}
