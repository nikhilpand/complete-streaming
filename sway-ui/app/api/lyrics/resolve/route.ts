import { NextRequest, NextResponse } from 'next/server';
import { resolveLyrics } from '@/lib/lyrics-engine/ultraLyricsResolver';

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
      videoId: videoId || (songId && !songId.includes(':') ? songId : undefined),
      providerId: songId && songId.includes(':') ? songId.split(':')[0] : undefined,
      providerTrackId: songId ? (songId.includes(':') ? songId.split(':')[1] : songId) : lyricsId,
      isrc,
    });

    const isFound = doc.status === 'FOUND';

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
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
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
