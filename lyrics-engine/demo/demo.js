/**
 * demo/demo.js - Standalone PC Showcase & Testing Harness
 */

import { LyricsEngineView } from '../src/index.js';

const SAMPLE_TRACKS = [
  {
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36'
  },
  {
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    album: '÷ (Divide)',
    duration: 233,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96'
  },
  {
    title: 'Gurenge',
    artist: 'LiSA',
    album: 'Gurenge',
    duration: 236,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b273646ba4a5a1766a505f03f390'
  },
  {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night At The Opera',
    duration: 354,
    albumArt: 'https://i.scdn.co/image/ab67616d0000b273ce4f1737bc8a646c8c4bd25a'
  }
];

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('lyrics-container');
  const playBtn = document.getElementById('btn-play');
  const timeSlider = document.getElementById('time-slider');
  const timeDisplay = document.getElementById('time-display');
  const songSelect = document.getElementById('song-select');
  const searchInput = document.getElementById('search-query');
  const searchBtn = document.getElementById('btn-search');
  const currentTitleEl = document.getElementById('track-title');
  const currentArtistEl = document.getElementById('track-artist');
  const currentArtEl = document.getElementById('album-art');

  let isPlaying = false;
  let currentTime = 0;
  let duration = 200000;
  let timer = null;

  const lyricsView = new LyricsEngineView(container, {
    onSeek: (timeMs) => {
      currentTime = timeMs;
      updateTimeUI();
      lyricsView.setTime(currentTime);
    }
  });

  function updateTimeUI() {
    timeSlider.value = (currentTime / duration) * 100;
    const curSec = Math.floor(currentTime / 1000);
    const durSec = Math.floor(duration / 1000);
    const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    timeDisplay.textContent = `${fmt(curSec)} / ${fmt(durSec)}`;
  }

  function startPlayback() {
    if (isPlaying) return;
    isPlaying = true;
    playBtn.textContent = '⏸ Pause';

    timer = setInterval(() => {
      currentTime += 100;
      if (currentTime >= duration) {
        currentTime = 0;
      }
      updateTimeUI();
      lyricsView.setTime(currentTime);
    }, 100);
  }

  function pausePlayback() {
    isPlaying = false;
    playBtn.textContent = '▶ Play';
    clearInterval(timer);
  }

  playBtn.addEventListener('click', () => {
    if (isPlaying) pausePlayback();
    else startPlayback();
  });

  timeSlider.addEventListener('input', (e) => {
    const pct = parseFloat(e.target.value) / 100;
    currentTime = Math.round(pct * duration);
    updateTimeUI();
    lyricsView.setTime(currentTime);
  });

  async function loadSong(track) {
    currentTitleEl.textContent = track.title;
    currentArtistEl.textContent = track.artist;
    currentArtEl.src = track.albumArt || 'https://via.placeholder.com/64';
    duration = (track.duration || 200) * 1000;
    currentTime = 0;
    updateTimeUI();

    await lyricsView.loadTrack(track);
  }

  SAMPLE_TRACKS.forEach((track, idx) => {
    const opt = document.createElement('option');
    opt.value = idx.toString();
    opt.textContent = `${track.title} — ${track.artist}`;
    songSelect.appendChild(opt);
  });

  songSelect.addEventListener('change', (e) => {
    const track = SAMPLE_TRACKS[parseInt(e.target.value, 10)];
    if (track) loadSong(track);
  });

  async function performSearch() {
    const q = searchInput.value.trim();
    if (!q) return;

    const parts = q.split('-');
    const title = parts[0]?.trim() || q;
    const artist = parts[1]?.trim() || '';

    const customTrack = {
      title,
      artist,
      duration: 210,
      albumArt: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300'
    };

    await loadSong(customTrack);
  }

  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  loadSong(SAMPLE_TRACKS[0]);
});
