/**
 * LyricsEngineView.js - Pure Vanilla JS Component API
 * For Electron, Tauri, or non-React web applications.
 */

import { LyricsEngine } from '../engine/LyricsEngine.js';
import { ColorExtractor } from '../visuals/ColorExtractor.js';
import { AmbientBackground } from '../visuals/AmbientBackground.js';

export class LyricsEngineView {
  constructor(rootContainer, options = {}) {
    this.root = rootContainer;
    this.options = {
      onSeek: options.onSeek || (() => {}),
      ...options
    };

    this.root.classList.add('lyrics-stage-container');

    this.engine = new LyricsEngine();
    this.background = new AmbientBackground(this.root);

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'lyrics-scroll-wrapper';
    this.stage = document.createElement('div');
    this.stage.className = 'lyrics-stage';
    this.wrapper.appendChild(this.stage);
    this.root.appendChild(this.wrapper);

    this.initControls();
    this.bindEvents();
    this.startScrollLoop();
  }

  initControls() {
    this.hud = document.createElement('div');
    this.hud.className = 'lyrics-controls-hud';
    this.hud.innerHTML = `
      <div class="hud-pill">
        <div class="hud-section"><span class="hud-dot"></span><span class="hud-provider-text">Ready</span></div>
        <div class="hud-divider"></div>
        <div class="hud-section">
          <button class="hud-btn offset-minus">−</button>
          <span class="hud-offset-val">0ms</span>
          <button class="hud-btn offset-plus">+</button>
        </div>
      </div>
    `;
    this.root.appendChild(this.hud);

    this.providerText = this.hud.querySelector('.hud-provider-text');
    this.offsetVal = this.hud.querySelector('.hud-offset-val');

    this.hud.querySelector('.offset-minus').addEventListener('click', () => {
      this.engine.setOffset(this.engine.offsetMs - 100);
      this.offsetVal.textContent = `${this.engine.offsetMs}ms`;
    });
    this.hud.querySelector('.offset-plus').addEventListener('click', () => {
      this.engine.setOffset(this.engine.offsetMs + 100);
      this.offsetVal.textContent = `${this.engine.offsetMs}ms`;
    });
  }

  bindEvents() {
    this.engine.on('loading', () => {
      this.providerText.textContent = 'Searching...';
      this.stage.innerHTML = '<div class="lyrics-empty-state">Searching lyrics...</div>';
    });

    this.engine.on('lyricsLoaded', (lyrics) => {
      this.providerText.textContent = lyrics.provider || 'Synced';
      this.renderLines(lyrics.lines);
    });

    this.engine.on('error', () => {
      this.providerText.textContent = 'Not Found';
      this.stage.innerHTML = '<div class="lyrics-empty-state">No lyrics found</div>';
    });

    this.engine.on('progress', ({ timeMs, activeLineIndex }) => {
      this.updateProgress(timeMs, activeLineIndex);
    });
  }

  renderLines(lines) {
    this.stage.innerHTML = '';
    this.lineEls = [];
    this.activeIdx = -1;

    const frag = document.createDocumentFragment();
    lines.forEach((l, idx) => {
      const div = document.createElement('div');
      div.className = 'lyric-line upcoming';

      if (l.words && l.words.length > 0) {
        l.words.forEach(w => {
          const span = document.createElement('span');
          span.className = 'lyric-word';
          span.textContent = w.text + ' ';
          span.dataset.start = w.startTime;
          span.dataset.end = w.endTime;
          div.appendChild(span);
        });
      } else {
        div.textContent = l.text;
      }

      div.addEventListener('click', () => this.options.onSeek(l.time));
      this.lineEls.push(div);
      frag.appendChild(div);
    });

    this.stage.appendChild(frag);
  }

  updateProgress(timeMs, newIdx) {
    if (!this.lineEls) return;

    if (newIdx !== this.activeIdx) {
      this.activeIdx = newIdx;
      this.lineEls.forEach((el, idx) => {
        if (idx < newIdx) el.className = 'lyric-line past';
        else if (idx === newIdx) el.className = 'lyric-line active';
        else el.className = 'lyric-line upcoming';
      });

      if (this.lineEls[this.activeIdx]) {
        const el = this.lineEls[this.activeIdx];
        this.targetScroll = Math.max(0, el.offsetTop - this.wrapper.clientHeight * 0.35);
      }
    }

    if (this.lineEls[this.activeIdx]) {
      const spans = this.lineEls[this.activeIdx].querySelectorAll('.lyric-word');
      spans.forEach(s => {
        const start = parseInt(s.dataset.start, 10);
        const end = parseInt(s.dataset.end, 10);
        if (timeMs >= end) s.style.setProperty('--fill', '100%');
        else if (timeMs < start) s.style.setProperty('--fill', '0%');
        else {
          const pct = ((timeMs - start) / Math.max(1, end - start)) * 100;
          s.style.setProperty('--fill', `${pct.toFixed(1)}%`);
        }
      });
    }
  }

  startScrollLoop() {
    this.currentScroll = 0;
    this.targetScroll = 0;
    const loop = () => {
      const diff = this.targetScroll - this.currentScroll;
      if (Math.abs(diff) > 0.5) {
        this.currentScroll += diff * 0.12;
        this.stage.style.transform = `translate3d(0, ${-this.currentScroll.toFixed(2)}px, 0)`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async loadTrack(track) {
    if (track.albumArt) {
      ColorExtractor.extractPalette(track.albumArt).then(p => this.background.setPalette(p));
    }
    return await this.engine.fetchLyrics(track);
  }

  setTime(timeMs) {
    this.engine.updateProgress(timeMs);
  }
}
