/**
 * @levelup/lyrics-engine - Standalone Core Lyrics Utility
 */

// Core Engine
export { LyricsEngine } from './engine/LyricsEngine.js';
export { Normalizer } from './engine/Normalizer.js';
export { LrcParser } from './engine/LrcParser.js';
export { StorageCache } from './engine/StorageCache.js';

// Providers
export { ProviderLRCLIB } from './engine/providers/ProviderLRCLIB.js';
export { ProviderMusixmatch } from './engine/providers/ProviderMusixmatch.js';
export { ProviderNetease } from './engine/providers/ProviderNetease.js';
export { ProviderGenius } from './engine/providers/ProviderGenius.js';

// Visuals & Atmosphere
export { ColorExtractor } from './visuals/ColorExtractor.js';
export { AmbientBackground } from './visuals/AmbientBackground.js';

// Vanilla JS Component
export { LyricsEngineView } from './vanilla/LyricsEngineView.js';
