/**
 * ProviderMusixmatch.js - Musixmatch Richsync Provider
 */

import { Normalizer } from '../Normalizer.js';
import { LrcParser } from '../LrcParser.js';

export class ProviderMusixmatch {
  static id = 'Musixmatch';
  static get name() { return 'Musixmatch'; }
  static priority = 3;
  static cachedToken = null;

  static async getUserToken() {
    if (this.cachedToken) return this.cachedToken;
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('mxm_user_token');
      if (saved) {
        this.cachedToken = saved;
        return saved;
      }
    }

    try {
      const tokenUrl = 'https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0';
      const res = await fetch(tokenUrl, {
        headers: {
          'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
          'Accept': 'application/json'
        }
      });
      const data = await res.json();
      const token = data?.message?.body?.user_token;
      if (token) {
        this.cachedToken = token;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('mxm_user_token', token);
        }
        return token;
      }
    } catch (_) {}

    return null;
  }

  static async getLyrics(trackInfo) {
    const cleanTitle = Normalizer.cleanTitle(trackInfo.title);
    const cleanArtist = Normalizer.getPrimaryArtist(trackInfo.artist);
    const durationSec = trackInfo.duration ? Math.round(trackInfo.duration / (trackInfo.duration > 1000 ? 1000 : 1)) : 0;

    const token = await this.getUserToken();
    if (!token) return null;

    try {
      const url = `https://apic-appmobile.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=mac-ios-v2.0&q_artist=${encodeURIComponent(cleanArtist)}&q_track=${encodeURIComponent(cleanTitle)}&q_duration=${durationSec}&usertoken=${token}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) return null;
      const data = await res.json();

      const calls = data?.message?.body?.macro_calls;
      if (!calls) return null;

      // 1. Richsync (syllables)
      const richsyncBody = calls['track.richsync.get']?.message?.body?.richsync?.richsync_body;
      if (richsyncBody) {
        try {
          const parsed = LrcParser.parse(richsyncBody);
          if (parsed.lines.length > 0) {
            return { ...parsed, provider: `${this.name} Richsync` };
          }
        } catch (_) {}
      }

      // 2. Subtitles
      const subtitleBody = calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
      if (subtitleBody) {
        const parsed = LrcParser.parse(subtitleBody);
        if (parsed.lines.length > 0) {
          return { ...parsed, provider: this.name };
        }
      }
    } catch (_) {}

    return null;
  }
}
