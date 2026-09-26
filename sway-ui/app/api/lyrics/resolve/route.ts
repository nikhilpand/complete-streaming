import { NextRequest, NextResponse } from 'next/server';
import { resolveLyrics } from '@/lib/lyrics-engine/ultraLyricsResolver';

const ENGINE_VERSION = 'v4';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const title = searchParams.get('title') || '';
  const artist = searchParams.get('artist') || '';
  const artistsParam = searchParams.get('artists');
  const artists = artistsParam ? artistsParam.split(',').map((a) => a.trim()).filter(Boolean) : undefined;
  const album = searchParams.get('album') || '';
  const subtitle = searchParams.get('subtitle') || '';

  const rawDuration = searchParams.get('duration');
  let durationMs = 0;
  if (rawDuration) {
    const val = parseFloat(rawDuration);
    if (!isNaN(val) && val > 0) {
      durationMs = val > 1000 ? Math.round(val) : Math.round(val * 1000);
    }
  }

  const videoId = searchParams.get('videoId') || undefined;
  const songId = searchParams.get('songId') || searchParams.get('id') || undefined;
  const isrc = searchParams.get('isrc') || undefined;
  const lyricsId = searchParams.get('lyricsId') || undefined;
  const streamUrl = searchParams.get('stream_url') || searchParams.get('streamUrl') || undefined;

  let provider: string | undefined = searchParams.get('provider') || undefined;
  let providerTrackId: string | undefined;

  if (songId) {
    if (songId.startsWith('youtube:') || songId.startsWith('yt:')) {
      provider = 'youtube';
      providerTrackId = songId.replace(/^(?:youtube|yt):/, '');
    } else if (songId.startsWith('saavn:')) {
      provider = 'saavn';
      providerTrackId = songId.replace(/^saavn:/, '');
    } else if (songId.includes(':')) {
      const parts = songId.split(':');
      provider = parts[0];
      providerTrackId = parts.slice(1).join(':');
    } else {
      providerTrackId = songId;
    }
  } else if (lyricsId) {
    providerTrackId = lyricsId;
  }

  if (!title.trim()) {
    return NextResponse.json(
      { status: 'NOT_FOUND', success: false, error: 'Title is required', error_code: 'MISSING_TITLE' },
      { status: 400 }
    );
  }

  try {
    const doc = await resolveLyrics({
      title,
      artist,
      artists,
      album,
      subtitle,
      durationMs,
      videoId: videoId || (provider === 'youtube' ? providerTrackId : undefined),
      provider,
      providerId: provider,
      providerTrackId,
      isrc,
      streamUrl,
    });

    const isFound = doc.status === 'FOUND';
    const recKey = doc.identity.recordingKey || 'default';
    const etag = `W/"lyrics:${ENGINE_VERSION}:${recKey}"`;

    // Check If-None-Match
    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304 });
    }

    return NextResponse.json(
      {
        success: isFound,
        status: doc.status,
        provider: doc.source.provider,
        source: doc.source,
        identity: doc.identity,
        syncQuality: doc.syncQuality,
        provenance: doc.provenance,
        lines: doc.lines,
        plainText: doc.plainText,
        capabilities: doc.capabilities,
        confidence: doc.confidence,
        data: doc, // for backward compatibility
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
          ETag: etag,
          'X-Lyrics-Engine-Version': ENGINE_VERSION,
        },
      }
    );
  } catch (error: any) {
    console.error('UltraLyrics resolution error:', error);
    return NextResponse.json(
      {
        status: 'NOT_FOUND',
        success: false,
        error: error?.message || 'Failed to resolve lyrics',
        confidence: 0,
      },
      { status: 500 }
    );
  }
}
