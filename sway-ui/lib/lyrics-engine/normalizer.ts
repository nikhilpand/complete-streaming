/**
 * normalizer.ts
 * Track Metadata Normalizer and Query Variant Generator (Section 5 & 6)
 */

import { TrackIdentity } from './types';

export interface NormalizedMetadata {
  rawTitle: string;
  cleanTitle: string;
  primaryArtist: string;
  allArtists: string[];
  cleanAlbum: string;
  contextTokens: string[];
  searchQueries: string[]; // Bounded set of max 6 queries
}

export function normalizeMetadata(identity: TrackIdentity): NormalizedMetadata {
  const rawTitle = identity.title || '';
  const rawAlbum = identity.album || '';
  const allArtists = identity.artists.filter((a) => a && a !== 'Unknown Artist');
  const primaryArtist = allArtists[0] || '';

  // 1. Unicode NFKC
  let titleNFKC = rawTitle.normalize('NFKC');
  let albumNFKC = rawAlbum.normalize('NFKC');

  // 2. Extract context tokens from movie tags e.g. (From "Brahmāstra")
  const contextTokens: string[] = [];
  const movieMatches = titleNFKC.matchAll(/(?:from|ost|soundtrack|film)\s+["']?([^"')]+)["']?/gi);
  for (const m of movieMatches) {
    if (m[1]) {
      contextTokens.push(m[1].trim().toLowerCase());
    }
  }

  // 3. Clean title while preserving version intent
  let cleanTitle = titleNFKC
    .replace(/\s*\(From\s+["'][^"']+["']\)/gi, '')
    .replace(/\s*\[From\s+["'][^"']+["']\]/gi, '')
    .replace(/\s*\(Original Motion Picture Track\)/gi, '')
    .replace(/\s*\(Original Motion Picture Soundtrack\)/gi, '')
    .replace(/\s*\(Original Soundtrack\)/gi, '')
    .replace(/\s*\(From\s+[^)]+\)/gi, '')
    .replace(/\s*\[From\s+[^\]]+\]/gi, '')
    .replace(/\s*-\s*(?:From|OST|Original|Official|Soundtrack).*/gi, '')
    .replace(/\s*-\s*(?:Lofi|Slowed|Reverb|Remix|Acoustic|Unplugged|Reprise|Version|Edition).*/gi, '')
    .trim();

  // Remove standalone parenthesis descriptors if they contain version or soundtrack words
  cleanTitle = cleanTitle
    .replace(/\s*\((?:Lofi|Slowed|Reverb|Remix|Dance Mix|Acoustic|Unplugged|Reprise|Version|Edition|Audio|Official Audio|Video|Official Video|Lyrics|Lyrical|Full Song|Soundtrack).*\)/gi, '')
    .replace(/\s*\[(?:Lofi|Slowed|Reverb|Remix|Dance Mix|Acoustic|Unplugged|Reprise|Version|Edition|Audio|Official Audio|Video|Official Video|Lyrics|Lyrical|Full Song|Soundtrack).*\]/gi, '')
    .replace(/\s*-\s*.*/, '')
    .trim();

  if (!cleanTitle) {
    cleanTitle = rawTitle.trim();
  }

  // Clean album
  let cleanAlbum = albumNFKC
    .replace(/\s*\(Original Motion Picture Soundtrack\)/gi, '')
    .replace(/\s*\(Original Soundtrack\)/gi, '')
    .replace(/\s*\(OST\)/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s*-\s*.*/, '')
    .trim();

  // 4. Generate Bounded Query Set (Max 6 Queries, ranked by specificity)
  const queries: string[] = [];

  // Q1 = exact title + primary artist
  if (rawTitle && primaryArtist) {
    queries.push(`${rawTitle} ${primaryArtist}`);
  }

  // Q2 = cleaned title + primary artist
  if (cleanTitle && primaryArtist) {
    queries.push(`${cleanTitle} ${primaryArtist}`);
  }

  // Q3 = cleaned title + all artists (if multiple)
  if (cleanTitle && allArtists.length > 1) {
    queries.push(`${cleanTitle} ${allArtists.slice(0, 2).join(' ')}`);
  }

  // Q4 = cleaned title + album (crucial for Bollywood where song is indexed under movie)
  if (cleanTitle && cleanAlbum && cleanAlbum.toLowerCase() !== cleanTitle.toLowerCase()) {
    queries.push(`${cleanTitle} ${cleanAlbum}`);
  }

  // Q5 = cleaned title + context token (e.g. extracted movie name)
  if (cleanTitle && contextTokens.length > 0) {
    queries.push(`${cleanTitle} ${contextTokens[0]}`);
  }

  // Q6 = clean title only
  if (cleanTitle) {
    queries.push(cleanTitle);
  }

  // De-duplicate while preserving order, enforce maximum 6
  const boundedQueries = Array.from(new Set(queries.map((q) => q.trim()))).filter(Boolean).slice(0, 6);

  return {
    rawTitle,
    cleanTitle,
    primaryArtist,
    allArtists,
    cleanAlbum,
    contextTokens,
    searchQueries: boundedQueries,
  };
}
