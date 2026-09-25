# 🎵 @levelup/lyrics-engine

A standalone, high-performance **Synchronized Lyrics Engine & Apple Music-Style Visual Stage** built specifically for PC / Desktop music players and React apps.

Features a cascading multi-provider pipeline (LRCLIB, Musixmatch Richsync, Netease CloudMusic, Genius) with dynamic fluid atmospheric backgrounds, syllable-by-syllable karaoke sweeps, physics lerp auto-scrolling, and instant IndexedDB caching.

---

## 🌟 Key Features

* **Maximum Global Coverage**: Cascades automatically across 4 major lyrics backends:
  1. **LRCLIB**: High-speed, public synchronized lyrics.
  2. **Musixmatch**: Syllable-level Richsync and global catalog.
  3. **Netease Cloud Music**: Massive Asian, J-Pop/Anime, EDM, and International database.
  4. **Genius**: Text lyrics fallback for underground, indie, or unreleased tracks.
* **Apple Music & Spicy Lyrics Aesthetics**:
  - **Fluid Dynamic Atmosphere**: GPU-composited canvas generating morphing gradient blobs derived from album art.
  - **Syllable Karaoke Fill**: Progressive left-to-right text fill (`background-clip: text`) synchronized to audio time.
  - **Physics Lerp Auto-Scroller**: Centers active lines at the 35% optical horizon without jumpy scrolls.
  - **Manual Scroll Override**: Detects user scrolling, pauses tracking, displays a floating **"Sync to Now"** pill, and resumes automatically.
* **Smart Normalizer**: Strips noise (`(feat. ...)`, `[Remastered]`, `(Deluxe)`, `[Live]`, `- Radio Edit`) to achieve high match rates across song databases.
* **Proportional Syllable Synthesizer**: Automatically synthesizes natural word-level karaoke timings even for standard LRC files lacking word timestamps.
* **Dual-Tier Cache**: High-speed IndexedDB with LocalStorage fallback (14-day TTL) for zero-latency instant loading.
* **Zero Overhead**: The rendering loop pauses automatically when audio is paused for 0% idle CPU usage.

---

## 📦 Installation & Setup

You can link or copy this folder directly into your React project:

```bash
# In your React app directory:
npm install c:/Users/nikhil/Desktop/projects/lyrics-engine
```

Or copy the files directly into your project's `src/lyrics` directory.

---

## 🚀 React Usage

### 1. Drop-in `<LyricsStage />` Component

```jsx
import React from 'react';
import { LyricsStage } from '@levelup/lyrics-engine/react';
import '@levelup/lyrics-engine/styles.css';

export function PlayerScreen({ currentTrack, currentTimeMs, isPlaying, audioPlayer }) {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <LyricsStage
        track={{
          title: currentTrack.title,
          artist: currentTrack.artist,
          duration: currentTrack.duration, // seconds or ms
          albumArt: currentTrack.coverUrl   // generates dynamic ambient colors
        }}
        currentTimeMs={currentTimeMs}
        isPlaying={isPlaying}
        onSeek={(timeMs) => audioPlayer.seek(timeMs)}
      />
    </div>
  );
}
```

### 2. Custom UI with the `useLyrics` Hook

If you want to build your own custom lyrics layout:

```jsx
import { useLyrics } from '@levelup/lyrics-engine/react';

function CustomLyricsView({ currentTrack, currentTimeMs, isPlaying }) {
  const {
    lyrics,        // Parsed lyrics object with lines and word timings
    activeLine,    // Currently active line object
    activeIndex,   // Index of current active line
    isLoading,     // True while querying providers
    provider,      // 'LRCLIB', 'Musixmatch Richsync', etc.
    offsetMs,      // Fine-tune offset in ms
    setOffsetMs    // Function to adjust offset (+/- 100ms)
  } = useLyrics({
    track: currentTrack,
    currentTimeMs,
    isPlaying
  });

  if (isLoading) return <div>Searching lyrics...</div>;
  if (!lyrics) return <div>No lyrics found</div>;

  return (
    <div className="my-lyrics-list">
      {lyrics.lines.map((line, idx) => (
        <p key={idx} className={idx === activeIndex ? 'active' : ''}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
```

---

## 💻 Vanilla JS / Electron / Tauri Usage

For desktop apps not using React:

```javascript
import { LyricsEngineView } from '@levelup/lyrics-engine';
import '@levelup/lyrics-engine/styles.css';

const container = document.getElementById('lyrics-container');

const view = new LyricsEngineView(container, {
  onSeek: (timeMs) => {
    myAudioPlayer.currentTime = timeMs / 1000;
  }
});

// Load song (automatically queries providers & updates ambient canvas)
await view.loadTrack({
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  albumArt: 'https://example.com/cover.jpg'
});

// Bind to your player's timeupdate event
myAudioPlayer.addEventListener('timeupdate', () => {
  view.setTime(myAudioPlayer.currentTime * 1000);
});
```

---

## 🧪 Testing the PC Demo

This folder includes an interactive test player:

1. Open a terminal in `c:\Users\nikhil\Desktop\projects\lyrics-engine`.
2. Start a simple web server:
   ```bash
   npx serve demo
   ```
   Or open `demo/index.html` with VSCode Live Server.
3. You can search any song in the world or pick from the sample playlist to test real-time lyrics synchronization and animations on your PC!

---

## 📂 Directory Structure

```
lyrics-engine/
├── package.json           # Module definition with subpath exports
├── README.md              # Documentation & usage guide
├── test/
│   └── test-engine.mjs    # Automated Node.js verification test suite
├── demo/
│   ├── index.html         # Interactive PC test app
│   └── demo.js            # Demo audio playback controller
└── src/
    ├── index.js           # Core barrel export
    ├── types.d.ts         # TypeScript definitions
    ├── engine/
    │   ├── Normalizer.js  # Metadata cleaner & title noise stripper
    │   ├── LrcParser.js   # Universal LRC & syllable parser
    │   ├── StorageCache.js# IndexedDB & LocalStorage cache
    │   ├── LyricsEngine.js# Cascading provider orchestrator
    │   └── providers/
    │       ├── ProviderLRCLIB.js
    │       ├── ProviderMusixmatch.js
    │       ├── ProviderNetease.js
    │       └── ProviderGenius.js
    ├── visuals/
    │   ├── ColorExtractor.js    # Offscreen canvas palette sampler
    │   └── AmbientBackground.js # GPU fluid mesh canvas
    ├── react/
    │   ├── index.js       # React subpath export
    │   ├── useLyrics.js   # Custom React hook
    │   └── LyricsStage.jsx# Turnkey React component
    ├── vanilla/
    │   └── LyricsEngineView.js  # Pure DOM component
    └── styles/
        └── lyrics-stage.css     # Apple Music glassmorphic styling
```
