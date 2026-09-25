/**
 * ColorExtractor.js - In-Memory Album Art Palette Extractor
 * Extracts dominant vibrant, muted, and atmospheric colors from album art via an offscreen canvas.
 */

export class ColorExtractor {
  static async extractPalette(imageSource) {
    // Anti-AI rule: Neutral organic slate/steel-blue default atmosphere instead of neon purple
    const defaultPalette = {
      primary: 'rgb(48, 62, 80)',    // Steel blue
      secondary: 'rgb(35, 45, 60)',  // Deep slate
      accent: 'rgb(70, 90, 115)',    // Muted sky
      dark: 'rgb(13, 15, 20)'        // Deep rich charcoal
    };

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return defaultPalette;
    }

    try {
      const img = await this.loadImage(imageSource);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return defaultPalette;

      canvas.width = 48;
      canvas.height = 48;
      ctx.drawImage(img, 0, 0, 48, 48);

      const imgData = ctx.getImageData(0, 0, 48, 48).data;
      const buckets = [];

      for (let i = 0; i < imgData.length; i += 16) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const a = imgData[i + 3];

        if (a < 128) continue;

        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);

        if (brightness > 15 && brightness < 235) {
          buckets.push({ r, g, b, saturation, brightness });
        }
      }

      if (buckets.length === 0) return defaultPalette;

      buckets.sort((a, b) => b.saturation - a.saturation);

      const dominant = buckets[0] || { r: 48, g: 62, b: 80 };
      const secondaryTone = buckets[Math.floor(buckets.length * 0.4)] || { r: 35, g: 45, b: 60 };
      const accentTone = buckets[Math.floor(buckets.length * 0.75)] || { r: 70, g: 90, b: 115 };

      // Organic dark backdrop tuned to sampled hue
      const darkR = Math.max(8, Math.min(22, Math.round(dominant.r * 0.12)));
      const darkG = Math.max(9, Math.min(24, Math.round(dominant.g * 0.12)));
      const darkB = Math.max(12, Math.min(28, Math.round(dominant.b * 0.15)));

      return {
        primary: `rgb(${dominant.r}, ${dominant.g}, ${dominant.b})`,
        secondary: `rgb(${secondaryTone.r}, ${secondaryTone.g}, ${secondaryTone.b})`,
        accent: `rgb(${accentTone.r}, ${accentTone.g}, ${accentTone.b})`,
        dark: `rgb(${darkR}, ${darkG}, ${darkB})`
      };
    } catch (_) {
      return defaultPalette;
    }
  }

  static loadImage(src) {
    if (src instanceof HTMLImageElement) {
      if (src.complete && src.naturalWidth > 0) return Promise.resolve(src);
      return new Promise((resolve, reject) => {
        src.onload = () => resolve(src);
        src.onerror = reject;
      });
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
}
