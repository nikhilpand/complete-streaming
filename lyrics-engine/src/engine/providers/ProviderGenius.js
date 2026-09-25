/**
 * ProviderGenius.js - Genius Fallback Provider for Indepth / Obscure Songs
 */

import { Normalizer } from '../Normalizer.js';
import { LrcParser } from '../LrcParser.js';

export class ProviderGenius {
  static id = 'Genius';
  static get name() { return 'Genius'; }
  static priority = 4;

  static async getLyrics(trackInfo) {
    const cleanTitle = Normalizer.cleanTitle(trackInfo.title);
    const cleanArtist = Normalizer.getPrimaryArtist(trackInfo.artist);
    const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);

    try {
      const searchUrl = `https://api.genius.com/search?q=${query}`;
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(searchUrl)}`);
      if (!res.ok) return null;
      const raw = await res.json();
      const data = JSON.parse(raw.contents);

      const hits = data?.response?.hits;
      if (!Array.isArray(hits) || hits.length === 0) return null;

      const hit = hits[0].result;
      if (!hit?.url) return null;

      // Scrape lyrics from Genius page via public CORS gateway
      const pageRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(hit.url)}`);
      if (!pageRes.ok) return null;
      const pageRaw = await pageRes.json();
      const doc = new DOMParser().parseFromString(pageRaw.contents, 'text/html');

      const containers = doc.querySelectorAll('[data-lyrics-container="true"]');
      let text = '';
      containers.forEach(c => {
        text += c.innerText + '\n';
      });

      if (text.trim()) {
        const parsed = LrcParser.parsePlain(text.trim());
        return { ...parsed, provider: this.name };
      }
    } catch (_) {}

    return null;
  }
}
