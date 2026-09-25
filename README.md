# SWAY — Complete Music Streaming Platform

A production-grade, full-stack music streaming platform featuring an editorial frontend, high-fidelity audio stream resolution, and the **Ultra Lyrics Engine** with word-level karaoke synchronization across Hindi, Punjabi, and International tracks.

---

## Architecture Overview

```
complete-streaming/
├── music/               # FastAPI Backend (JioSaavn Provider, Audio Alignment, API Services)
├── sway-ui/             # Next.js 16 (App Router) Frontend + Ultra Lyrics Engine
├── sway_taste_engine/   # Graph & Embedding-based Music Recommendation Engine
├── docs/                # Architectural Specifications & Provider Integration Guides
└── files/               # Engine Utilities & Demonstrations
```

---

## Key Features

### 1. Ultra Lyrics Engine
- **Multi-Provider Parallel Cascade**: Queries multiple sources simultaneously with sub-100ms response times.
  - **BiniLyrics**: Apple Music TTML with syllable & word-by-word timestamps.
  - **Unison**: High-accuracy crowdsourced RichSync TTML and LRC timestamps.
  - **LRCLIB**: Fast community line-synchronized and plain-text lyrics.
  - **JioSaavn**: Official Indian regional lyrics database.
  - **Musixmatch**: RichSync word-level timestamps and subtitles.
  - **YouTube Music**: Timed caption streams.
- **Word-Level Karaoke Highlighting**: Active line and active word highlighting with precise millisecond duration tracking.
- **Auto-Scrolling Sync**: Smooth auto-centering viewport transitions with manual override detection and resume timer.
- **Script Romanization**: Automatic transliteration of Devanagari (Hindi) and Gurmukhi (Punjabi) to readable Latin scripts.

### 2. Editorial UI / UX (`sway-ui`)
- **Next.js 16 + React 19 + Tailwind CSS**: Zero-latency UI updates with server components and fine-grained Zustand store subscriptions.
- **Artwork-Driven Dynamic Theming**: Real-time palette extraction generating atmospheric OKLCH ambient glows.
- **Command Palette Search**: Global `/` trigger for instant cross-entity search (songs, artists, albums, playlists).
- **Responsive Player**: Seamless morphing transition between mini-player and fullscreen immersive karaoke mode.

### 3. Audio & Streaming Pipeline (`music`)
- High-bitrate audio stream extraction and caching (up to 320kbps AAC/MP4).
- Direct media resolution with fallback failover.
- RESTful OpenAPI-compliant endpoints for easy client integration.

---

## Benchmark Performance

The Ultra Lyrics Engine achieves **100% resolution** across regional and international test suites:

| Track | Sync Tier | Words Synced | Provider | Latency |
|---|---|---|---|---|
| **Kesariya** (Hindi) | Word-Sync | 209 words | BiniLyrics | ~9ms |
| **Husn** (Indie) | Word-Sync | 244 words | BiniLyrics | ~11ms |
| **Softly** (Punjabi) | Word-Sync | 301 words | BiniLyrics | ~15ms |
| **Starboy** (English) | Word-Sync | 473 words | BiniLyrics | ~8ms |
| **Until I Found You** | Word-Sync | 262 words | Musixmatch | ~15ms |
| **Tum Hi Ho** (Hindi) | Line-Sync | 36 lines | BiniLyrics | ~60ms |
| **Blinding Lights** | Line-Sync | 40 lines | LRCLIB | ~6ms |
| **Shape of You** | Line-Sync | 93 lines | LRCLIB | ~14ms |

---

## Getting Started

### Prerequisites
- **Node.js**: v18+ (Node 20+ recommended)
- **Python**: 3.10+
- **Git**

---

### Backend Setup (`music/`)

1. Navigate to the backend directory:
   ```bash
   cd music
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # Linux / macOS:
   source .venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure environment:
   ```bash
   cp .env.example .env
   ```

5. Start the backend server:
   ```bash
   python -m uvicorn app.main:app --port 8000 --reload
   ```
   API docs will be available at `http://localhost:8000/docs`.

---

### Frontend Setup (`sway-ui/`)

1. Navigate to the frontend directory:
   ```bash
   cd sway-ui
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env.local
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## License

This project is licensed under the MIT License.
