/**
 * ProviderNetease.js - Netease Cloud Music Provider
 */

import { Normalizer } from '../Normalizer.js';
import { LrcParser } from '../LrcParser.js';

export class ProviderNetease {
  static id = 'Netease';
  static get name() { return 'Netease'; }
  static priority = 2;

  static async getLyrics(trackInfo) {
    const cleanTitle = Normalizer.cleanTitle(trackInfo.title);
    const cleanArtist = Normalizer.getPrimaryArtist(trackInfo.artist);
    const keyword = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);

    try {
      const searchUrl = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${keyword}&type=1&offset=0&total=true&limit=5`;
      const res = await fetch(searchUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'Cookie': 'os=pc'
        }
      });
      if (!res.ok) return null;

      const searchData = await res.json();
      const songs = searchData?.result?.songs;
      if (!Array.isArray(songs) || songs.length === 0) return null;

      const songId = songs[0].id;
      if (!songId) return null;

      const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
      const lrcRes = await fetch(lyricUrl, {
        headers: {
          'Referer': 'https://music.163.com',
          'Cookie': 'os=pc'
        }
      });
      if (!lrcRes.ok) return null;

      const lyricData = await lrcRes.json();
      if (!lyricData?.lrc?.lyric) return null;

      const parsed = LrcParser.parse(lyricData.lrc.lyric);
      return { ...parsed, provider: this.name };
    } catch (_) {
      return null;
    }
  }
}
