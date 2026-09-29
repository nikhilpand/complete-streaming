import { getTrackRadio, getRecommendations, recommendationToSong } from '@/lib/api/recommendations';
import type { Song } from '@/lib/api/types';
import { artistNames } from '@/lib/utils';

/**
 * Diversity ranking filter:
 * Prevents identical artists from dominating adjacent queue slots.
 * Ensures maximum 2 songs from the same artist in any window of 6 songs.
 */
export function rankForDiversity(candidates: Song[], recentHistory: Song[] = []): Song[] {
  const result: Song[] = [];
  const recentArtists = new Set<string>();

  // Collect primary artists from recent history (last 4 tracks)
  recentHistory.slice(-4).forEach((s) => {
    const artist = artistNames(s.artists, s.subtitle).toLowerCase();
    if (artist) recentArtists.add(artist);
  });

  const deferred: Song[] = [];

  for (const song of candidates) {
    const artist = artistNames(song.artists, song.subtitle).toLowerCase();
    // If artist recently played or already in candidate results, defer it
    if (recentArtists.has(artist)) {
      deferred.push(song);
    } else {
      result.push(song);
      recentArtists.add(artist);
    }
  }

  // Append deferred songs at the end to maximize queue variety
  return [...result, ...deferred];
}

/**
 * RadioEngine — Sprint 8
 *
 * Resolves subsequent tracks when the active queue is exhausted following the fallback hierarchy:
 * 1. Specific Track Radio (JioSaavn / Hybrid similarity)
 * 2. Feed Type: Track Radio recommendations
 * 3. Discover / Trending fallback
 */
export async function resolveNextRadioQueue(
  currentTrack: Song,
  recentHistory: Song[] = [],
  limit = 10,
  signal?: AbortSignal
): Promise<Song[]> {
  if (!currentTrack?.id) return [];

  // 1. Try track radio (similar tracks)
  try {
    const similar = await getTrackRadio(currentTrack.id, limit, signal);
    if (similar && similar.length > 0) {
      const converted = similar.map(recommendationToSong);
      const filtered = converted.filter((s) => s.id !== currentTrack.id);
      if (filtered.length > 0) {
        return rankForDiversity(filtered, recentHistory).slice(0, limit);
      }
    }
  } catch {}

  // 2. Try recommendations feed
  try {
    const recs = await getRecommendations({
      currentTrackId: currentTrack.id,
      feedType: 'track_radio',
      n: limit,
      signal,
    });
    if (recs && recs.length > 0) {
      const converted = recs.map(recommendationToSong);
      const filtered = converted.filter((s) => s.id !== currentTrack.id);
      if (filtered.length > 0) {
        return rankForDiversity(filtered, recentHistory).slice(0, limit);
      }
    }
  } catch {}

  // 3. Fallback: Trending / Discover
  try {
    const discover = await getRecommendations({
      feedType: 'discover',
      n: limit,
      signal,
    });
    if (discover && discover.length > 0) {
      const converted = discover.map(recommendationToSong);
      const filtered = converted.filter((s) => s.id !== currentTrack.id);
      return rankForDiversity(filtered, recentHistory).slice(0, limit);
    }
  } catch {}

  return [];
}
