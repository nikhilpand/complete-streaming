'use client';

const ANON_KEY = 'sway_anon_id';
const SESSION_KEY = 'sway_session_id';
const SESSION_TIMESTAMP_KEY = 'sway_session_last_active';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

export function getAnonymousId(): string {
  if (typeof window === 'undefined') return 'anon_ssr';
  let anonId = localStorage.getItem(ANON_KEY);
  if (!anonId) {
    anonId = generateId('anon');
    localStorage.setItem(ANON_KEY, anonId);
  }
  return anonId;
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return 'sess_ssr';
  const now = Date.now();
  const lastActiveStr = localStorage.getItem(SESSION_TIMESTAMP_KEY);
  const existingSession = localStorage.getItem(SESSION_KEY);

  if (lastActiveStr && existingSession) {
    const lastActive = parseInt(lastActiveStr, 10);
    if (now - lastActive < SESSION_TIMEOUT_MS) {
      localStorage.setItem(SESSION_TIMESTAMP_KEY, now.toString());
      return existingSession;
    }
  }

  // Generate new session after inactivity timeout or initial visit
  const newSession = generateId('sess');
  localStorage.setItem(SESSION_KEY, newSession);
  localStorage.setItem(SESSION_TIMESTAMP_KEY, now.toString());
  return newSession;
}

export function getIdentityHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {
    'x-sway-anon-id': getAnonymousId(),
    'x-sway-session-id': getSessionId(),
  };
  const accountId = localStorage.getItem('sway_account_id');
  if (accountId) {
    headers['x-sway-user-id'] = accountId;
  }
  return headers;
}

export interface TelemetryEvent {
  event_type:
    | 'play_started'
    | 'play_10s'
    | 'play_30s'
    | 'play_50pct'
    | 'completed'
    | 'skip_lt_10s'
    | 'skip_10_30s'
    | 'like'
    | 'dislike'
    | 'replay'
    | 'search';
  track_id?: string;
  title?: string;
  artist?: string;
  artist_id?: string;
  artwork_url?: string;
  source?: string;
  query?: string;
  position_ms?: number;
  duration_ms?: number;
  completion_ratio?: number;
  metadata?: Record<string, any>;
}

export function sendTelemetry(event: TelemetryEvent): void {
  if (typeof window === 'undefined') return;

  const anonId = getAnonymousId();
  const sessionId = getSessionId();
  const accountId = localStorage.getItem('sway_account_id') || undefined;

  const payload = {
    event_id: `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    user_id: accountId || anonId,
    session_id: sessionId,
    anonymous_id: anonId,
    account_id: accountId,
    event_type: event.event_type,
    track_id: event.track_id || '',
    title: event.title,
    artist: event.artist,
    artist_id: event.artist_id,
    source: event.source,
    query: event.query,
    position_ms: event.position_ms,
    duration_ms: event.duration_ms,
    completion_ratio: event.completion_ratio,
    metadata: {
      ...(event.metadata || {}),
      ...(event.title ? { title: event.title } : {}),
      ...(event.artist ? { artist: event.artist } : {}),
      ...(event.artwork_url ? { artwork_url: event.artwork_url } : {}),
    },
  };

  const url = '/api/proxy/recommendations/events';

  // Use non-blocking fetch
  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getIdentityHeaders(),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Non-blocking telemetry
    });
  } catch {
    // Suppress errors silently
  }
}
