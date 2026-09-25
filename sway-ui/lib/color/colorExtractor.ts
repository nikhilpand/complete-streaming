import { FastAverageColor } from 'fast-average-color';

export interface Palette {
  primary: string;
  r: number; g: number; b: number;
  h: number; s: number; l: number;
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

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
    else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
    else h = ((r1 - g1) / d + 4) / 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export async function extractPalette(imageUrl: string): Promise<Palette> {
  if (!imageUrl || !imageUrl.trim()) return defaultPalette();
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
    const { h, s, l } = rgbToHsl(r, g, b);
    const palette: Palette = { r, g, b, h, s, l, primary: `rgb(${r},${g},${b})` };
    cache.set(imageUrl, palette);
    return palette;
  } catch {
    return defaultPalette();
  }
}

function defaultPalette(): Palette {
  return { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)', h: 215, s: 35, l: 18 };
}

export function applyPalette(p: Palette) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--art-primary', p.primary);
  root.style.setProperty('--art-secondary', `rgba(${p.r},${p.g},${p.b},0.7)`);
  root.style.setProperty('--art-accent', `rgba(${p.r},${p.g},${p.b},0.35)`);
  root.style.setProperty('--art-wash', `rgba(${p.r},${p.g},${p.b},0.08)`);
  root.style.setProperty('--art-h', String(p.h));
  root.style.setProperty('--art-s', `${Math.max(20, p.s)}%`);
  root.style.setProperty('--art-l', `${p.l}%`);
  root.style.setProperty('--art-bg-main', `hsl(${p.h}, ${Math.min(30, p.s)}%, 7%)`);
}

export function scheduleExtract(url: string, done: (p: Palette) => void) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => extractPalette(url).then(done));
  } else {
    setTimeout(() => extractPalette(url).then(done), 100);
  }
}
