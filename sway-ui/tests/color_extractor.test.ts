import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { extractPalette, applyPalette, scheduleExtract, Palette } from '../lib/color/colorExtractor';

describe('ColorExtractor Hardcore Edge Cases', () => {
  beforeEach(() => {
    // Reset DOM globals if needed
  });

  test('extractPalette with empty, whitespace, or invalid image URLs returns defaultPalette', async () => {
    const p1 = await extractPalette('');
    assert.deepEqual(p1, { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)', h: 215, s: 35, l: 18 });

    const p2 = await extractPalette('    \t\n  ');
    assert.deepEqual(p2, { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)', h: 215, s: 35, l: 18 });

    const p3 = await extractPalette(null as unknown as string);
    assert.deepEqual(p3, { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)', h: 215, s: 35, l: 18 });
  });

  test('extractPalette in server/headless environment without window returns defaultPalette', async () => {
    const origWindow = (globalThis as any).window;
    try {
      delete (globalThis as any).window;
      const palette = await extractPalette('https://example.com/art.jpg');
      assert.deepEqual(palette, { r: 80, g: 80, b: 90, primary: 'rgb(80,80,90)', h: 215, s: 35, l: 18 });
    } finally {
      (globalThis as any).window = origWindow;
    }
  });

  test('applyPalette sets CSS custom properties on document.documentElement', () => {
    const styleMap = new Map<string, string>();
    const mockDoc = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => {
            styleMap.set(name, value);
          },
        },
      },
    };

    (globalThis as any).document = mockDoc;

    const testPalette: Palette = {
      primary: 'rgb(200,50,50)',
      r: 200,
      g: 50,
      b: 50,
      h: 0,
      s: 60,
      l: 49,
    };

    applyPalette(testPalette);

    assert.equal(styleMap.get('--art-primary'), 'rgb(200,50,50)');
    assert.equal(styleMap.get('--art-secondary'), 'rgba(200,50,50,0.7)');
    assert.equal(styleMap.get('--art-accent'), 'rgba(200,50,50,0.35)');
    assert.equal(styleMap.get('--art-wash'), 'rgba(200,50,50,0.08)');
    assert.equal(styleMap.get('--art-h'), '0');
    assert.equal(styleMap.get('--art-s'), '60%');
    assert.equal(styleMap.get('--art-l'), '49%');
    assert.equal(styleMap.get('--art-bg-main'), 'hsl(0, 30%, 7%)');
  });

  test('applyPalette clamps low saturation for --art-s to at least 20%', () => {
    const styleMap = new Map<string, string>();
    (globalThis as any).document = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => {
            styleMap.set(name, value);
          },
        },
      },
    };

    const desaturatedPalette: Palette = {
      primary: 'rgb(100,100,100)',
      r: 100,
      g: 100,
      b: 100,
      h: 180,
      s: 5, // low saturation
      l: 39,
    };

    applyPalette(desaturatedPalette);
    assert.equal(styleMap.get('--art-s'), '20%'); // Clamped to min 20%
    assert.equal(styleMap.get('--art-bg-main'), 'hsl(180, 5%, 7%)');
  });

  test('scheduleExtract invokes callback via requestIdleCallback or setTimeout fallback', async () => {
    let idleCbCalled = false;
    (globalThis as any).requestIdleCallback = (cb: () => void) => {
      idleCbCalled = true;
      cb();
    };

    await new Promise<void>((resolve) => {
      scheduleExtract('https://example.com/test.jpg', (palette) => {
        assert.ok(palette);
        resolve();
      });
    });

    assert.equal(idleCbCalled, true);

    // Test setTimeout fallback when requestIdleCallback is undefined
    delete (globalThis as any).requestIdleCallback;
    let timeoutUsed = false;

    await new Promise<void>((resolve) => {
      scheduleExtract('', (palette) => {
        assert.ok(palette);
        timeoutUsed = true;
        resolve();
      });
    });

    assert.equal(timeoutUsed, true);
  });
});
