/**
 * ytmusic.ts
 * YouTube Music InnerTube Lyrics Provider Adapter (Section 3.2 & 17)
 */

import { ILyricsProvider } from './base';
import { TrackIdentity, LyricsCandidate } from '../types';
import { NormalizedMetadata } from '../normalizer';
import { providerHealthTracker } from '../health';

export class YouTubeMusicLyricsProvider implements ILyricsProvider {
  readonly providerId = 'ytmusic' as const;

  async resolveCandidates(
    identity: TrackIdentity,
    normalized: NormalizedMetadata,
    signal?: AbortSignal
  ): Promise<LyricsCandidate[]> {
    if (!providerHealthTracker.isAvailable(this.providerId)) {
      return [];
    }

    const videoId = identity.videoId || (identity.providerId === 'ytmusic' ? identity.providerTrackId : undefined);
    if (!videoId) {
      // YTM lyrics requires a videoId
      return [];
    }

    const startTime = Date.now();
    try {
      // 1. Query InnerTube Next endpoint to get the Lyrics browseId
      const nextRes = await fetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-YouTube-Client-Name': '67',
          'X-YouTube-Client-Version': '1.20240101.01.00',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
        signal: signal || AbortSignal.timeout(3500),
      });

      if (!nextRes.ok) {
        providerHealthTracker.recordFailure(this.providerId, 'SERVER_ERROR');
        return [];
      }

      const nextData = await nextRes.json();
      const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
      const lyricsTab = tabs.find((t: any) => t?.tabRenderer?.title === 'Lyrics');
      const browseId = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;

      if (!browseId) {
        providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', Date.now() - startTime);
        return [];
      }

      // 2. Query InnerTube Browse endpoint with the lyrics browseId
      const browseRes = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-YouTube-Client-Name': '67',
          'X-YouTube-Client-Version': '1.20240101.01.00',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'en',
              gl: 'US',
            },
          },
          browseId,
        }),
        signal: signal || AbortSignal.timeout(3500),
      });

      if (!browseRes.ok) {
        providerHealthTracker.recordFailure(this.providerId, 'SERVER_ERROR');
        return [];
      }

      const browseData = await browseRes.json();
      const shelf = browseData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer;
      if (!shelf) {
        providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', Date.now() - startTime);
        return [];
      }

      const lyricsText = shelf.description?.runs?.map((r: any) => r.text).join('') || '';
      const sourceFooter = shelf.footer?.runs?.map((r: any) => r.text).join('') || 'YouTube Music';

      if (!lyricsText || lyricsText.trim().length < 20) {
        providerHealthTracker.recordFailure(this.providerId, 'NOT_FOUND', Date.now() - startTime);
        return [];
      }

      const candidate: LyricsCandidate = {
        providerId: this.providerId,
        providerTrackId: videoId,
        title: identity.title,
        artists: identity.artists,
        album: identity.album,
        durationMs: identity.durationMs,
        plainLyrics: lyricsText.trim(),
        instrumental: false,
        sourceReference: sourceFooter,
        providerConfidence: 0.95, // High confidence bonus due to direct ecosystem lookup
        fetchedAtMs: Date.now(),
      };

      providerHealthTracker.recordSuccess(this.providerId, Date.now() - startTime);
      return [candidate];
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        providerHealthTracker.recordFailure(this.providerId, 'TIMEOUT');
      } else {
        providerHealthTracker.recordFailure(this.providerId, 'NETWORK');
      }
      return [];
    }
  }
}

export const ytmusicProvider = new YouTubeMusicLyricsProvider();
