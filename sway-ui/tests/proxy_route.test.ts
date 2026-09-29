import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST, PUT, PATCH, DELETE } from '../app/api/proxy/[...path]/route';

describe('Next.js App Router Proxy Route Hardcore Tests', () => {
  const originalFetch = globalThis.fetch;
  let interceptedFetchUrl: string | null = null;
  let interceptedFetchOptions: RequestInit | null = null;
  let mockFetchResponse: { status: number; body: any } = { status: 200, body: { success: true } };
  let mockFetchError: Error | null = null;

  beforeEach(() => {
    interceptedFetchUrl = null;
    interceptedFetchOptions = null;
    mockFetchResponse = { status: 200, body: { success: true } };
    mockFetchError = null;

    (globalThis as any).fetch = async (url: string | URL | Request, options?: RequestInit) => {
      interceptedFetchUrl = String(url);
      interceptedFetchOptions = options || null;

      if (mockFetchError) {
        throw mockFetchError;
      }

      return {
        status: mockFetchResponse.status,
        json: async () => mockFetchResponse.body,
      } as any;
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockRequest(urlStr: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
    const parsedUrl = new URL(urlStr, 'http://localhost:3000');
    return {
      method: options.method || 'GET',
      nextUrl: parsedUrl,
      headers: {
        get: (h: string) => {
          const l = h.toLowerCase();
          for (const [k, v] of Object.entries(options.headers || {})) {
            if (k.toLowerCase() === l) return v;
          }
          return null;
        },
      },
      json: async () => options.body ?? {},
    } as any;
  }

  test('path sanitization strips saavn: prefix but preserves youtube:, yt:, and spotify: prefixes', async () => {
    // 1. saavn: stripped
    const req1 = createMockRequest('http://localhost:3000/api/proxy/songs/saavn:track_123');
    await GET(req1, { params: Promise.resolve({ path: ['songs', 'saavn:track_123'] }) });
    assert.ok(interceptedFetchUrl?.includes('/api/v1/songs/track_123'));
    assert.ok(!interceptedFetchUrl?.includes('saavn:'));

    // 2. youtube: preserved
    const req2 = createMockRequest('http://localhost:3000/api/proxy/songs/youtube:vid_999');
    await GET(req2, { params: Promise.resolve({ path: ['songs', 'youtube:vid_999'] }) });
    assert.ok(interceptedFetchUrl?.includes('/api/v1/songs/youtube:vid_999'));

    // 3. yt: preserved
    const req3 = createMockRequest('http://localhost:3000/api/proxy/songs/yt:short_456');
    await GET(req3, { params: Promise.resolve({ path: ['songs', 'yt:short_456'] }) });
    assert.ok(interceptedFetchUrl?.includes('/api/v1/songs/yt:short_456'));

    // 4. spotify: preserved
    const req4 = createMockRequest('http://localhost:3000/api/proxy/playlists/spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    await GET(req4, { params: Promise.resolve({ path: ['playlists', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'] }) });
    assert.ok(interceptedFetchUrl?.includes('/api/v1/playlists/spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'));
  });

  test('query parameter boundaries sanitized (page >= 1, n in 1..50)', async () => {
    // page negative, n > 50
    const req = createMockRequest('http://localhost:3000/api/proxy/search?q=arijit&page=-5&n=250');
    await GET(req, { params: Promise.resolve({ path: ['search'] }) });

    const called = new URL(interceptedFetchUrl!);
    assert.equal(called.searchParams.get('q'), 'arijit');
    assert.equal(called.searchParams.get('page'), '1'); // Clamped to 1
    assert.equal(called.searchParams.get('n'), '50'); // Clamped to 50

    // page invalid NaN, n < 1
    const req2 = createMockRequest('http://localhost:3000/api/proxy/search?q=test&page=garbage&n=-10');
    await GET(req2, { params: Promise.resolve({ path: ['search'] }) });

    const called2 = new URL(interceptedFetchUrl!);
    assert.equal(called2.searchParams.get('page'), '1');
    assert.equal(called2.searchParams.get('n'), '20'); // Invalid < 1 resets to 20

    // 0-indexed endpoint (artists) preserves page=0
    const req3 = createMockRequest('http://localhost:3000/api/proxy/artists/459345/songs?page=0&n=30');
    await GET(req3, { params: Promise.resolve({ path: ['artists', '459345', 'songs'] }) });

    const called3 = new URL(interceptedFetchUrl!);
    assert.equal(called3.searchParams.get('page'), '0');
    assert.equal(called3.searchParams.get('n'), '30');
  });

  test('user identity and telemetry headers forwarded to upstream', async () => {
    const req = createMockRequest('http://localhost:3000/api/proxy/home', {
      headers: {
        'x-sway-user-id': 'u_usr123',
        'x-sway-anon-id': 'anon_888',
        'x-sway-session-id': 'sess_999',
        'authorization': 'Bearer fake_token',
      },
    });

    await GET(req, { params: Promise.resolve({ path: ['home'] }) });

    const headers = interceptedFetchOptions?.headers as Record<string, string>;
    assert.equal(headers['x-sway-user-id'], 'u_usr123');
    assert.equal(headers['x-sway-anon-id'], 'anon_888');
    assert.equal(headers['x-sway-session-id'], 'sess_999');
    assert.equal(headers['Content-Type'], 'application/json');
    // Foreign authorization header not forwarded
    assert.equal(headers['authorization'], undefined);
  });

  test('POST forwards JSON body correctly', async () => {
    const payload = {
      event_type: 'play_started',
      track_id: 'saavn:123',
      position_ms: 0,
    };
    const req = createMockRequest('http://localhost:3000/api/proxy/recommendations/events', {
      method: 'POST',
      body: payload,
    });

    await POST(req, { params: Promise.resolve({ path: ['recommendations', 'events'] }) });

    assert.equal(interceptedFetchOptions?.method, 'POST');
    assert.equal(interceptedFetchOptions?.body, JSON.stringify(payload));
  });

  test('PATCH forwards JSON body and headers correctly', async () => {
    const payload = { name: 'Updated Playlist' };
    const req = createMockRequest('http://localhost:3000/api/proxy/playlists/p1', {
      method: 'PATCH',
      headers: { 'x-sway-user-id': 'u_tester' },
      body: payload,
    });

    await PATCH(req, { params: Promise.resolve({ path: ['playlists', 'p1'] }) });

    assert.equal(interceptedFetchOptions?.method, 'PATCH');
    assert.equal(interceptedFetchOptions?.body, JSON.stringify(payload));
    const headers = interceptedFetchOptions?.headers as Record<string, string>;
    assert.equal(headers['x-sway-user-id'], 'u_tester');
  });

  test('PUT forwards JSON body and headers correctly', async () => {
    const payload = { title: 'New Title' };
    const req = createMockRequest('http://localhost:3000/api/proxy/playlists/p1', {
      method: 'PUT',
      headers: { 'x-sway-user-id': 'u_tester' },
      body: payload,
    });

    await PUT(req, { params: Promise.resolve({ path: ['playlists', 'p1'] }) });

    assert.equal(interceptedFetchOptions?.method, 'PUT');
    assert.equal(interceptedFetchOptions?.body, JSON.stringify(payload));
    const headers = interceptedFetchOptions?.headers as Record<string, string>;
    assert.equal(headers['x-sway-user-id'], 'u_tester');
  });

  test('DELETE forwards method correctly', async () => {
    const req = createMockRequest('http://localhost:3000/api/proxy/playlists/p1', {
      method: 'DELETE',
      headers: { 'x-sway-user-id': 'u_tester' },
    });

    await DELETE(req, { params: Promise.resolve({ path: ['playlists', 'p1'] }) });

    assert.equal(interceptedFetchOptions?.method, 'DELETE');
    const headers = interceptedFetchOptions?.headers as Record<string, string>;
    assert.equal(headers['x-sway-user-id'], 'u_tester');
  });

  test('path traversal attempts are rejected with 400 INVALID_PATH', async () => {
    const req = createMockRequest('http://localhost:3000/api/proxy/../../../etc/passwd');
    const res = await GET(req, { params: Promise.resolve({ path: ['..', '..', 'etc', 'passwd'] }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error_code, 'INVALID_PATH');
  });

  test('upstream network error or timeout returns 503 PROXY_ERROR safely', async () => {
    mockFetchError = new Error('ECONNREFUSED 127.0.0.1:8000');

    const req = createMockRequest('http://localhost:3000/api/proxy/search?q=test');
    const res = await GET(req, { params: Promise.resolve({ path: ['search'] }) });

    assert.equal(res.status, 503);
    const data = await res.json();
    assert.deepEqual(data, {
      success: false,
      error: 'Backend unreachable',
      error_code: 'PROXY_ERROR',
    });
  });
});
