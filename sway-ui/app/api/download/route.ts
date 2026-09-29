import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mediaUrl = searchParams.get('url');
  const filename = searchParams.get('filename') || 'track.m4a';

  if (!mediaUrl) {
    return NextResponse.json({ error: 'Missing media url' }, { status: 400 });
  }

  try {
    // 1. Forward client Range header to allow parallel/chunked acceleration and resume
    const rangeHeader = req.headers.get('range');
    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
    };
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    // 2. Stream directly from upstream without buffering
    const upstreamRes = await fetch(mediaUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(90000),
      cache: 'no-store',
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return NextResponse.json(
        { error: 'Failed to fetch audio stream from upstream' },
        { status: upstreamRes.status || 502 }
      );
    }

    const contentType = upstreamRes.headers.get('content-type') || 'audio/mp4';
    const contentLength = upstreamRes.headers.get('content-length');
    const contentRange = upstreamRes.headers.get('content-range');
    const acceptRanges = upstreamRes.headers.get('accept-ranges') || 'bytes';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', acceptRanges);
    headers.set('Cache-Control', 'public, max-age=7200, immutable');

    // 3. Clean attachment filename for Content-Disposition
    const cleanHeaderFilename = filename.replace(/["\r\n]/g, '').trim();
    headers.set(
      'Content-Disposition',
      `attachment; filename="${cleanHeaderFilename}"; filename*=UTF-8''${encodeURIComponent(cleanHeaderFilename)}`
    );

    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }
    if (contentRange) {
      headers.set('Content-Range', contentRange);
    }

    // 4. Return streaming response (200 OK or 206 Partial Content)
    return new NextResponse(upstreamRes.body as any, {
      status: upstreamRes.status,
      headers,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Download failed' },
      { status: 500 }
    );
  }
}
