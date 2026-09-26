export type ImageQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface ArtistSummary {
  id: string;
  name: string;
  role?: string;
  image_url?: string;
  perma_url?: string;
}

export interface Song {
  id: string;
  provider: string;
  provider_id: string;
  type: 'song';
  title: string;
  subtitle?: string;
  artist_name?: string;
  artists?: ArtistSummary[];
  featured_artists?: ArtistSummary[];
  album?: string;
  album_id?: string;
  duration_ms?: number;
  artwork_url?: string;
  language?: string;
  year?: number;
  release_date?: string;
  label?: string;
  copyright_text?: string;
  has_lyrics?: boolean;
  lyrics_id?: string;
  lyrics_snippet?: string;
  has_media?: boolean;
  is_explicit?: boolean;
  perma_url?: string;
}

export interface Stream {
  quality: string;
  url: string;
  mime_type: string;
  bitrate_kbps?: number;
}

export interface MediaResolution {
  song_id: string;
  provider: string;
  streams: Stream[];
  resolved_at: string;
  expires_hint?: number;
}

export interface Album {
  id: string;
  provider: string;
  provider_id: string;
  type: 'album';
  title: string;
  artists?: ArtistSummary[];
  year?: number;
  language?: string;
  artwork_url?: string;
  song_count?: number;
  perma_url?: string;
  songs?: Song[];
}

export interface Artist {
  id: string;
  provider: string;
  provider_id: string;
  type: 'artist';
  name: string;
  image_url?: string;
  follower_count?: number;
  fan_count?: number;
  bio?: string;
  dob?: string;
  available_languages?: string[];
  top_songs?: Song[];
  top_albums?: Album[];
  singles?: Song[];
}

export interface Playlist {
  id: string;
  provider: string;
  provider_id: string;
  type: 'playlist';
  title: string;
  artwork_url?: string;
  follower_count?: number;
  song_count?: number;
  last_updated?: string;
  owner?: string;
  perma_url?: string;
  songs?: Song[];
}

export interface SearchResultItem {
  id: string;
  provider: string;
  provider_id: string;
  type: 'song' | 'album' | 'artist' | 'playlist';
  title: string;
  subtitle?: string;
  artwork_url?: string;
  perma_url?: string;
  extra?: any;
}

export interface SearchResponseData {
  query: string;
  songs?: SearchResultItem[];
  albums?: SearchResultItem[];
  artists?: SearchResultItem[];
  playlists?: SearchResultItem[];
  total_songs?: number;
  total_albums?: number;
  total_artists?: number;
  total_playlists?: number;
  enriched_songs?: Song[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  error_code?: string;
}

export interface QueueTrack {
  id: string;
  title: string;
  artist_name: string;
  artists?: ArtistSummary[];
  album?: string;
  year?: number;
  language?: string;
  artwork_url?: string;
  energy?: number;
  popularity?: number;
}

export interface QueueNextResponse {
  current_track_id: string;
  queue: QueueTrack[];
  count: number;
}

export interface RecommendationTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork_url?: string;
  genre?: string;
  mood?: string;
  score?: number;
  source?: string;
  explanation?: string;
  badge?: string;
}

export interface UserTasteProfile {
  user_id: string;
  archetype: string;
  top_genres: string[];
  top_artists: string[];
  top_moods: string[];
  play_count: number;
}
