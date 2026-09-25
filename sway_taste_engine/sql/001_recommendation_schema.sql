CREATE TABLE IF NOT EXISTS listening_events (
 event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, event_type TEXT NOT NULL,
 track_id TEXT, artist_id TEXT, album_id TEXT, position_ms BIGINT, duration_ms BIGINT,
 completion_ratio DOUBLE PRECISION, source TEXT, recommendation_id TEXT, query TEXT,
 event_ts TIMESTAMPTZ NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON listening_events(user_id,event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_session_time ON listening_events(session_id,event_ts DESC);
CREATE TABLE IF NOT EXISTS user_taste_profiles (
 user_id TEXT PRIMARY KEY, profile_version TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 novelty_tolerance DOUBLE PRECISION NOT NULL DEFAULT .25, familiarity_preference DOUBLE PRECISION NOT NULL DEFAULT .75,
 long_term_energy DOUBLE PRECISION, recent_energy DOUBLE PRECISION, profile JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS recommendation_impressions (
 recommendation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, feed TEXT NOT NULL, track_id TEXT NOT NULL,
 rank_position INTEGER NOT NULL, source TEXT NOT NULL, algorithm_version TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reco_impressions_user_time ON recommendation_impressions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS recommendation_feedback (
 feedback_id TEXT PRIMARY KEY, recommendation_id TEXT, user_id TEXT NOT NULL, track_id TEXT NOT NULL,
 feedback_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reco_feedback_user_time ON recommendation_feedback(user_id,created_at DESC);
-- pgvector can be added later for track/user embeddings.
