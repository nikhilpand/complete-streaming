import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) {
    return NextResponse.json(
      { success: false, error: 'Missing url query parameter', error_code: 'MISSING_URL' },
      { status: 400 }
    );
  }

  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json(
        { success: false, error: 'Invalid URL protocol', error_code: 'INVALID_PROTOCOL' },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed target URL', error_code: 'INVALID_URL' },
      { status: 400 }
    );
  }

  // Forward range requests to enable native scrubbing and seeking in HTML5 audio
  const fetchHeaders: Record<string, string> = {
    'User-Agent':
      req.headers.get('user-agent') ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  const clientRange = req.headers.get('range');
  if (clientRange) {
    fetchHeaders['Range'] = clientRange;
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: fetchHeaders,
      signal: req.signal,
    });

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept-Encoding');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    headers.set('Accept-Ranges', 'bytes');

    for (const h of ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag']) {
      const val = upstreamRes.headers.get(h);
      if (val) {
        headers.set(h, val);
      }
    }

    if (!headers.has('content-type')) {
      headers.set('content-type', 'audio/mp4');
    }

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  } catch (err: unknown) {
    const e = err as Error;
    if (e.name === 'AbortError') {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json(
      { success: false, error: 'Stream proxy fetch failed: ' + e.message, error_code: 'STREAM_FETCH_FAILED' },
      { status: 502 }
    );
  }
}

export async function HEAD(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          req.headers.get('user-agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: req.signal,
    });

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept-Encoding');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    headers.set('Accept-Ranges', 'bytes');

    for (const h of ['content-type', 'content-length', 'content-range', 'cache-control']) {
      const val = upstreamRes.headers.get(h);
      if (val) headers.set(h, val);
    }

    return new NextResponse(null, {
      status: upstreamRes.status,
      headers,
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept-Encoding',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    },
  });
}
