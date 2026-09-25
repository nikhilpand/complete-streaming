/**
 * Normalizer.js - Smart Metadata Sanitizer & Fuzzy Matcher
 * Strips title noise: (feat. ...), [Remastered], (Deluxe), [Live], etc.
 */

export class Normalizer {
  static cleanTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let clean = title
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/【/g, '[').replace(/】/g, ']')
      .replace(/‘|’|′|＇/g, "'").replace(/“|”/g, '"')
      .replace(/〜/g, '~').replace(/·|・/g, '•');

    clean = clean.replace(/(\(|\[)\s*(feat\.?|ft\.?|featuring|with|prod\.?)\s+[^)\]]+(\)|\])/gi, '');
    clean = clean.replace(/-\s*(feat\.?|ft\.?|featuring|with|prod\.?)\s+.+$/gi, '');
    // Remove version annotations: (Remastered 2021), [Deluxe Edition], (Remix), (Live at ...), etc.
    clean = clean.replace(/(\(|\[)\s*(remaster(?:ed)?(?:\s*\d{4})?|remix|deluxe(?:\s*edition|\s*version)?|anniversary(?:\s*edition)?|special(?:\s*edition)?|expanded(?:\s*edition)?|live(?:\s+at[^)\]]+)?|mono|stereo|bonus\s*track|radio\s*edit|club\s*mix|extended\s*mix|acoustic|instrumental|sped\s*up|slowed(?:\s*\+\s*reverb)?|official\s*(?:video|audio|music\s*video))\s*(\)|\])/gi, '');
    clean = clean.replace(/\s+-\s+(remastered|deluxe|live|radio edit|mono|stereo).*$/gi, '');
    return clean.replace(/\s+/g, ' ').trim() || title.trim();
  }

  static getPrimaryArtist(artists) {
    if (Array.isArray(artists) && artists.length > 0) {
      const first = artists[0];
      return (typeof first === 'object' ? first.name : first).trim();
    }
    if (typeof artists === 'string') {
      let str = artists.trim();
      if (str.includes(' · ') || str.includes(' • ')) {
        const parts = str.split(/\s+[·•]\s+/);
        str = parts[parts.length - 1];
      }
      return str.split(/[,&/|]/)[0].trim();
    }
    return '';
  }

  static isDurationMatch(dur1, dur2, toleranceSec = 5) {
    if (!dur1 || !dur2) return true;
    return Math.abs(dur1 - dur2) <= toleranceSec;
  }
}
