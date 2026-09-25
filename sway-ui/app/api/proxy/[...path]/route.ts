import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

function buildBackendUrl(path: string[], searchParams: URLSearchParams) {
  const cleanPath = path.map((segment) => {
    if (segment.startsWith('youtube:') || segment.startsWith('yt:')) {
      return segment;
    }
    return segment.replace(/^saavn:/, '');
  });
  const backendPath = '/api/v1/' + cleanPath.join('/');

  // Sanitize query params
  const sanitizedParams = new URLSearchParams(searchParams);
  if (sanitizedParams.has('page')) {
    const pageVal = parseInt(sanitizedParams.get('page') || '1', 10);
    if (isNaN(pageVal) || pageVal < 1) {
      sanitizedParams.set('page', '1');
    }
  }
  if (sanitizedParams.has('n')) {
    const nVal = parseInt(sanitizedParams.get('n') || '20', 10);
    if (isNaN(nVal) || nVal < 1) {
      sanitizedParams.set('n', '20');
    } else if (nVal > 50) {
      sanitizedParams.set('n', '50');
    }
  }

  const query = sanitizedParams.toString();
  const search = query ? `?${query}` : '';
  return `${BACKEND}${backendPath}${search}`;
}

function getProxyHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const h of ['x-sway-user-id', 'x-sway-anon-id', 'x-sway-session-id']) {
    const val = req.headers.get(h);
    if (val) headers[h] = val;
  }
  return headers;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = buildBackendUrl(path, req.nextUrl.searchParams);

  try {
    const res = await fetch(url, {
      headers: getProxyHeaders(req),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Backend unreachable', error_code: 'PROXY_ERROR' },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = buildBackendUrl(path, req.nextUrl.searchParams);

  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(url, {
      method: 'POST',
      headers: getProxyHeaders(req),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Backend unreachable', error_code: 'PROXY_ERROR' },
      { status: 503 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = buildBackendUrl(path, req.nextUrl.searchParams);

  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Backend unreachable', error_code: 'PROXY_ERROR' },
      { status: 503 }
    );
  }
}
