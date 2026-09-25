/**
 * ProviderLRCLIB.js - High Reliability Synchronized Lyrics Provider
 */

import { Normalizer } from '../Normalizer.js';
import { LrcParser } from '../LrcParser.js';

export class ProviderLRCLIB {
  static id = 'LRCLIB';
  static get name() { return 'LRCLIB'; }
  static priority = 1;

  static async getLyrics(trackInfo) {
    const cleanTitle = Normalizer.cleanTitle(trackInfo.title);
    const cleanArtist = Normalizer.getPrimaryArtist(trackInfo.artist);
    const durationSec = trackInfo.duration ? Math.round(trackInfo.duration / (trackInfo.duration > 1000 ? 1000 : 1)) : 0;

    // Phase 1: Exact Match
    try {
      const params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist
      });
      if (trackInfo.album) params.append('album_name', trackInfo.album);
      if (durationSec > 0) params.append('duration', durationSec.toString());

      const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
        headers: { 'Lrclib-Client': 'LevelUpLyricsEngine/2.0' }
      });

      if (res.status === 200) {
        const data = await res.json();
        const parsed = this.parseResult(data);
        if (parsed) return parsed;
      }
    } catch (_) {}

    // Phase 2: Fuzzy Search
    try {
      const query = `${cleanTitle} ${cleanArtist}`.trim();
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Lrclib-Client': 'LevelUpLyricsEngine/2.0' }
      });

      if (searchRes.status === 200) {
        const list = await searchRes.json();
        if (Array.isArray(list) && list.length > 0) {
          let best = list.find(item => item.syncedLyrics && Normalizer.isDurationMatch(item.duration, durationSec, 5));
          if (!best) best = list.find(item => item.syncedLyrics);
          if (!best) best = list[0];

          const parsed = this.parseResult(best);
          if (parsed) return parsed;
        }
      }
    } catch (_) {}

    return null;
  }

  static parseResult(data) {
    if (!data) return null;
    if (data.instrumental) {
      return {
        lines: [{ time: 0, endTime: 999999, text: '♪ Instrumental ♪', words: null }],
        isSynced: true,
        hasSyllables: false,
        provider: this.name
      };
    }

    if (data.syncedLyrics) {
      const parsed = LrcParser.parse(data.syncedLyrics);
      return { ...parsed, provider: this.name };
    }

    if (data.plainLyrics) {
      const parsed = LrcParser.parse(data.plainLyrics);
      return { ...parsed, provider: this.name };
    }

    return null;
  }
}
