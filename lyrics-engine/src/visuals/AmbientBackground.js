/**
 * AmbientBackground.js - GPU-Accelerated Dynamic Atmosphere Canvas
 * Apple Music fluid gradient blobs that breathe and adapt to album art with near-zero CPU footprint.
 */

export class AmbientBackground {
  constructor(containerElement) {
    this.container = containerElement;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ambient-canvas';
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.container.appendChild(this.canvas);

    // Anti-AI aesthetic: Organic sampled atmosphere, no neon purple
    this.palette = {
      primary: [48, 62, 80],
      secondary: [35, 45, 60],
      accent: [70, 90, 115],
      dark: [13, 15, 20]
    };

    this.targetPalette = { ...this.palette };
    this.paletteLerpFactor = 0.05;

    // Organic ambient atmosphere centers that gently breathe
    this.blobs = [
      { x: 0.35, y: 0.30, vx: 0.0003, vy: 0.0002, r: 0.70, colorKey: 'primary' },
      { x: 0.65, y: 0.40, vx: -0.0002, vy: 0.0003, r: 0.75, colorKey: 'secondary' },
      { x: 0.50, y: 0.25, vx: 0.0002, vy: -0.0002, r: 0.60, colorKey: 'accent' }
    ];

    this.isRunning = false;
    this.rafId = null;
    this.time = 0;

    this.initCanvas();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resizeCanvas());
    }
  }

  initCanvas() {
    this.resizeCanvas();
    this.start();
  }

  resizeCanvas() {
    this.width = 320;
    this.height = 240;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  setPalette(newPalette) {
    this.targetPalette = {
      primary: this.parseRgb(newPalette.primary),
      secondary: this.parseRgb(newPalette.secondary),
      accent: this.parseRgb(newPalette.accent),
      dark: this.parseRgb(newPalette.dark)
    };
  }

  parseRgb(colorStr) {
    if (!colorStr) return [30, 30, 45];
    const m = colorStr.match(/\d+/g);
    if (m && m.length >= 3) {
      return [parseInt(m[0], 10), parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    return [30, 30, 45];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.renderLoop();
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  renderLoop = () => {
    if (!this.isRunning) return;
    this.update();
    this.draw();
    this.rafId = requestAnimationFrame(this.renderLoop);
  };

  update() {
    this.time += 0.015;

    for (const key of ['primary', 'secondary', 'accent', 'dark']) {
      const cur = this.palette[key];
      const target = this.targetPalette[key];
      if (cur && target) {
        cur[0] += (target[0] - cur[0]) * this.paletteLerpFactor;
        cur[1] += (target[1] - cur[1]) * this.paletteLerpFactor;
        cur[2] += (target[2] - cur[2]) * this.paletteLerpFactor;
      }
    }

    for (const b of this.blobs) {
      b.x += b.vx + Math.sin(this.time * 0.6) * 0.0005;
      b.y += b.vy + Math.cos(this.time * 0.5) * 0.0005;

      if (b.x < 0.1 || b.x > 0.9) b.vx *= -1;
      if (b.y < 0.1 || b.y > 0.9) b.vy *= -1;
    }
  }

  draw() {
    const { ctx, width, height } = this;
    const dark = this.palette.dark;

    ctx.fillStyle = `rgb(${Math.round(dark[0])}, ${Math.round(dark[1])}, ${Math.round(dark[2])})`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';

    for (const b of this.blobs) {
      const px = b.x * width;
      const py = b.y * height;
      const radius = b.r * Math.min(width, height) * (1 + 0.08 * Math.sin(this.time + b.x * 3));

      const col = this.palette[b.colorKey] || this.palette.primary;
      const r = Math.round(col[0]);
      const g = Math.round(col[1]);
      const bColor = Math.round(col[2]);

      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      // Soft, organic atmospheric opacities
      grad.addColorStop(0, `rgba(${r}, ${g}, ${bColor}, 0.38)`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${bColor}, 0.14)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${bColor}, 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}
