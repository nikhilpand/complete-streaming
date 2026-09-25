import { FastAverageColor } from 'fast-average-color';

export interface Palette {
  primary: string;
  r: number; g: number; b: number;
}

const cache = new Map<string, Palette>();
let fac: FastAverageColor | null = null;

function getFac() {
  if (!fac && typeof window !== 'undefined') fac = new FastAverageColor();
  return fac;
}

function saturate(r: number, g: number, b: number) {
  const avg = (r + g + b) / 3;
  const f = 1.4;
  return {
    r: Math.round(Math.max(0, Math.min(255, avg + (r - avg) * f))),
    g: Math.round(Math.max(0, Math.min(255, avg + (g - avg) * f))),
    b: Math.round(Math.max(0, Math.min(255, avg + (b - avg) * f))),
  };
}

export async function extractPalette(imageUrl: string): Promise<Palette> {
  if (cache.has(imageUrl)) return cache.get(imageUrl)!;
  const f = getFac();
  if (!f) return defaultPalette();
  try {
    const color = await f.getColorAsync(imageUrl, {
      crossOrigin: 'anonymous',
      algorithm: 'dominant',
      ignoredColor: [[0,0,0,255,30],[255,255,255,255,30]],
    });
    const [ri, gi, bi] = color.value;
    const { r, g, b } = saturate(ri, gi, bi);
    const palette: Palette = { r, g, b, primary: `rgb(${r},${g},${b})` };
    cache.set(imageUrl, palette);
    return palette;
  } catch {
    return defaultPalette();
  }
}

function defaultPalette(): Palette {
  return { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)' };
}

export function applyPalette(p: Palette) {
  const root = document.documentElement;
  root.style.setProperty('--art-primary', p.primary);
  root.style.setProperty('--art-secondary', `rgba(${p.r},${p.g},${p.b},0.7)`);
  root.style.setProperty('--art-accent', `rgba(${p.r},${p.g},${p.b},0.35)`);
  root.style.setProperty('--art-wash', `rgba(${p.r},${p.g},${p.b},0.08)`);
}

export function scheduleExtract(url: string, done: (p: Palette) => void) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => extractPalette(url).then(done));
  } else {
    setTimeout(() => extractPalette(url).then(done), 100);
  }
}
