# YouTube Music-Grade Taste & Recommendation Engine Implementation Plan (Revised V2)

> **Execution Workflow:** Follow TDD (Red → Green → Refactor) task-by-task. Each phase defines exact contracts, test cases, and commits. Do not skip phases or combine tasks.

**Goal:** Transform SWAY's recommendation system from shallow searches and empty mock mappings into a true YouTube Music-grade taste and recommendation platform. Features multi-horizon persistent taste profiling, dynamic precomputed top-K similarity graphs ($O(1)$ retrieval), 300+ multi-generator candidate budgeting, transition-aware sequence optimization for the Next Queue, a multi-shelf Home feed, and strict separation of playback telemetry from player mechanics.

**Tech Stack:** Python 3.14, FastAPI, SQLite (WAL mode, non-blocking connection pool), Pydantic v2, Next.js 16 (App Router), Zustand v5, TypeScript.

---

## 1. Architectural Guardrails & Principles

1. **Configurable Prior Weights, Not Hardcoded Constants:**
   All algorithm weights reside in strongly typed configuration models (`RecommendationWeights`, `QueueWeights`), tunable at runtime or via environment variables without modifying core logic.
   - `RecommendationWeights`: `like: 2.5`, `save: 2.75`, `completed: 1.0`, `replay: 1.1`, `play_30s: 0.3`, `play_10s: 0.15`, `skip_10_30s: -0.6`, `skip_lt_10s: -1.4`, `dislike: -3.5`, `not_interested: -5.0`.
   - `QueueWeights`: `mood_continuity: 0.30`, `energy_smoothness: 0.25`, `artist_affinity: 0.20`, `transition_graph: 0.15`, `novelty: 0.10`.

2. **Metadata vs. Feature Provenance:**
   - **Factual Features:** Real provider facts (`title`, `artists` with roles, `album`, `year`, `duration_ms`, `language`, `composer`, `lyricist`, `provider_popularity`, `artwork_url`).
   - **Derived Features:** Inferred features (`energy`, `bpm`, `moods`, `acousticness`, `danceability`, `valence`) must be wrapped in `FeatureValue[T](value: Optional[T], source: str, confidence: float)`.
   - **Zero Fake Defaults:** If energy or BPM is unknown, store `None` with `confidence=0.0`. Never fabricate constants like `energy=0.7` or `bpm=105`.

3. **Precomputed / Cached Similarity Edges ($O(1)$ Retrieval):**
   - No pairwise $O(N^2)$ candidate comparisons at request time.
   - Candidate edges are computed during ingestion, playback, or candidate gathering and cached in SQLite `similarity_edges` (`from_track_id`, `to_track_id`, `score`, `source`, `updated_at`).
   - Retrievers query indexed edges directly: `SELECT to_track_id, score FROM similarity_edges WHERE from_track_id = ? ORDER BY score DESC LIMIT ?`.
   - `SimilarTrackRetriever` and `SimilarArtistRetriever` never operate with empty maps.

4. **Candidate Pool Budgeting (Target 300, Min 150, Max 500):**
   Exact per-generator quotas before deduplication:
   - `same_artist`: budget 40
   - `similar_artists`: budget 50
   - `album_soundtrack`: budget 30
   - `taste_neighbors`: budget 50
   - `collaborative`: budget 50
   - `discovery`: budget 50
   - `exploration`: budget 30
   Total candidate pool is deduplicated by canonical track ID into a diverse set of 150–350 items.

5. **Canonical Telemetry Contract & 3-Tier Identity:**
   - `account_id`: Optional registered user identity.
   - `anonymous_id`: Persistent UUID (`sway_anon_id`) stored in browser storage.
   - `session_id`: Ephemeral session identifier (`sess_<timestamp>_<random>`), expiring after 30 minutes of inactivity (never `f"sess_{user_id}"`).
   - Strict separation: Player/audio engine only emits playback milestones; taste engine consumes normalized telemetry.

6. **Storage Abstraction:**
   `TasteStore` abstract interface (`ABC`) backed by `SQLiteTasteStore` (WAL mode, busy timeout 5000ms, connection pooling), ready for future PostgreSQL swap.

7. **Observability & Debugging:**
   Full attribution endpoint `GET /api/v1/recommendations/debug` detailing feature breakdowns (`artist_affinity`, `track_similarity`, `session_fit`, `novelty`, `freshness`, `negative_checks`). Shadow mode comparator evaluates V2 alongside legacy logic without user disruption.

8. **Sequence Planning vs. Isolated Scoring:**
   Next Queue is solved as a continuous transition problem ($A \rightarrow B \rightarrow C$), preserving mood and energy flow without jarring genre cliffs.

---

## 2. Target Component & Directory Architecture

```
sway_taste_engine/
├── sway_taste_engine/
│   ├── __init__.py
│   ├── config.py                 # Tunable weights: RecommendationWeights, QueueWeights, DecayConfig
│   ├── models.py                 # Canonical Track, FeatureValue, UserEvent, EventType, Multi-Horizon TasteProfile
│   ├── storage.py                # Abstract TasteStore & SQLiteTasteStore (WAL mode, connection safe)
│   ├── normalizer.py             # EventNormalizer: validates telemetry, resolves 3-tier identity, applies weights
│   ├── profile.py                # Multi-horizon TasteProfileBuilder (7d recent, 60d long-term, session, negative memory)
│   ├── metadata.py               # Feature extractor: factual provider fields + FeatureValue provenance
│   ├── similarity.py             # Jaccard artist/composer + era + token similarity engine & Top-K graph builder
│   ├── retrieval.py              # Dynamic retrievers with precomputed SQLite edge lookups
│   ├── ranking.py                # RuleBasedRanker with configurable weights & score attribution components
│   ├── diversity.py              # MMR & sliding-window diversity re-ranker (max 2/artist, max 3/album)
│   ├── queue_planner.py          # Sequence-aware Next Queue transition optimizer (A -> B continuity)
│   ├── mix_planner.py            # Multi-shelf playlist & mix composer (Quick Mix, Artist Radar, Rediscover)
│   └── engine.py                 # Master RecommendationEngine facade
└── tests/
    ├── test_config.py
    ├── test_event_models.py
    ├── test_sqlite_storage.py
    ├── test_normalizer.py
    ├── test_profile_decay.py
    ├── test_metadata_extractor.py
    ├── test_similarity.py
    ├── test_ranking_explanations.py
    ├── test_diversity.py
    └── test_queue_planner.py

music/
├── app/
│   ├── routers/
│   │   ├── recommendations.py    # Upgraded telemetry, radio, and debug endpoints
│   │   ├── home.py               # Multi-shelf home feed endpoint (/api/v1/home)
│   │   └── queue.py              # Sequence-optimized next queue endpoint (/api/v1/queue/next)
│   └── services/
│       └── candidate_builder.py  # 300+ candidate multi-generator aggregator with per-generator budgets
└── tests/
    └── integration/
        ├── test_candidate_builder.py
        ├── test_recommendations_api.py
        ├── test_home_api.py
        └── test_queue_api.py

sway-ui/
├── lib/
│   ├── api/
│   │   ├── home.ts               # Home feed types & API client
│   │   ├── queue.ts              # Queue API client
│   │   └── telemetry.ts          # 3-tier identity manager & milestone telemetry batcher
│   └── hooks/
│       └── usePlayback.ts        # Milestone playback telemetry (10s, 30s, 50%, completed, skips)
└── app/
    └── page.tsx                  # Multi-shelf editorial home feed (Quick Mix, Because You Listened, Artist Radar)
```

---

## 3. Revised 10-Phase Implementation Plan

### Phase 0: Contract Freeze & Configurable Models

**Objectives:**
- Define `RecommendationWeights` and `QueueWeights` configuration models.
- Upgrade `Track` model to support factual features and `FeatureValue[T]` derived feature provenance without fake defaults.
- Standardize 3-tier identity (`account_id`, `anonymous_id`, `session_id`) and `EventType` milestones.
- Update `UserTasteProfile` to structure multi-horizon state (`long_term`, `recent_30d`, `session_state`, `negative_memory`, `discovery_tolerance`).
- Define `ScoreBreakdown` schema for explainable recommendations.

**Files:**
- Create: `sway_taste_engine/sway_taste_engine/config.py`
- Modify: `sway_taste_engine/sway_taste_engine/models.py`
- Test: `sway_taste_engine/tests/test_config.py`, `sway_taste_engine/tests/test_event_models.py`

**Tasks:**
- [ ] **Task 0.1: Write tests for configurable weights and multi-horizon models**
  - Verify `RecommendationWeights` defaults match calibrated prior values (`like: 2.5`, `save: 2.75`, `completed: 1.0`, `replay: 1.1`, `play_30s: 0.3`, `play_10s: 0.15`, `skip_10_30s: -0.6`, `skip_lt_10s: -1.4`, `dislike: -3.5`, `not_interested: -5.0`).
  - Verify `QueueWeights` defaults match continuity requirements (`mood_continuity: 0.30`, `energy_smoothness: 0.25`, `artist_affinity: 0.20`, `transition_graph: 0.15`, `novelty: 0.10`).
  - Verify `Track` initializes with optional `FeatureValue` derived attributes, allowing `None` values and recording feature source and confidence.
  - Verify `UserEvent` validates 3-tier identity (`account_id`, `anonymous_id`, `session_id`) and milestone event types.
- [ ] **Task 0.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_config.py sway_taste_engine/tests/test_event_models.py`
- [ ] **Task 0.3: Implement `config.py` and update `models.py`**
  - Implement Pydantic `BaseModel` settings in `config.py`.
  - Update `models.py` with `FeatureValue`, structured `ArtistRole`, `EventType`, `UserEvent`, and multi-horizon `UserTasteProfile`.
- [ ] **Task 0.4: Re-run tests to confirm green state**
- [ ] **Task 0.5: Commit**
  `git commit -m "feat(taste): freeze contracts for multi-horizon profile, configurable weights, and feature provenance"`

---

### Phase 1: Persistence Layer & Storage Abstraction

**Objectives:**
- Create `TasteStore` abstract interface (`ABC`) defining profiles, events, track metadata, similarity edges, and transition logs.
- Implement production `SQLiteTasteStore` with WAL mode, non-blocking connection management, busy timeout (5000ms), and indexed queries.
- Support atomic upserts and indexed top-K similarity edge retrieval ($O(1)$).

**Files:**
- Modify: `sway_taste_engine/sway_taste_engine/storage.py`
- Test: `sway_taste_engine/tests/test_sqlite_storage.py`

**Tasks:**
- [ ] **Task 1.1: Write tests for SQLiteTasteStore operations**
  - Test profile save and retrieval across distinct store instances.
  - Test event logging, deduplication by `event_id`, and horizon queries (`get_recent_events(user_id, days=30)`).
  - Test similarity edge upsert and top-K nearest neighbor lookup ($O(1)$ query by `from_track_id`).
  - Test transition recording ($A \rightarrow B$ completion and skip counters) and transition score query.
  - Test thread concurrency and WAL mode configuration.
- [ ] **Task 1.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_sqlite_storage.py`
- [ ] **Task 1.3: Implement `TasteStore` interface and `SQLiteTasteStore`**
  - Schema tables: `taste_profiles`, `event_telemetry`, `tracks`, `similarity_edges` (`(from_track_id, to_track_id, score, source, updated_at)`), `track_transitions` (`(from_track_id, to_track_id, count_completed, count_skipped)`).
  - Connection context manager with `PRAGMA journal_mode=WAL;` and row factory.
- [ ] **Task 1.4: Re-run tests to confirm green state**
- [ ] **Task 1.5: Commit**
  `git commit -m "feat(storage): implement SQLiteTasteStore with WAL mode and similarity edge indexing"`

---

### Phase 2: Taste Profile Engine & Event Normalization

**Objectives:**
- Build `EventNormalizer` to validate client telemetry, resolve 3-tier identities, and compute effective playback weights.
- Implement `TasteProfileBuilder` with dual-horizon exponential decay:
  - Rolling 30-day: 7-day half-life ($w(t) = w_0 \cdot 2^{-\Delta t / 7}$).
  - Long-term: 60-day half-life ($w(t) = w_0 \cdot 2^{-\Delta t / 60}$).
  - Session state: Immediate updates to recent session tracks, artist trajectory, and energy drift.
  - Explicit negative memory: Immediate blacklisting of disliked tracks/artists and fast penalty for early skips (<10s).

**Files:**
- Create: `sway_taste_engine/sway_taste_engine/normalizer.py`
- Modify: `sway_taste_engine/sway_taste_engine/profile.py`
- Test: `sway_taste_engine/tests/test_normalizer.py`, `sway_taste_engine/tests/test_profile_decay.py`

**Tasks:**
- [ ] **Task 2.1: Write tests for event normalization and multi-horizon decay**
  - Test normalization: assigns calibrated weights based on completion ratio and milestones (e.g., skip <10s = -1.4, completed = +1.0, like = +2.5).
  - Test decay: verifies an event 14 days ago decays by $75\%$ in `recent_30d` but only by $15\%$ in `long_term`.
  - Test negative memory: verifies `dislike` immediately prunes artist affinity and records track in `explicit_negative_tracks`.
  - Test session mood: verifies consecutive listens in a session dynamically update `session_state.active_moods`.
- [ ] **Task 2.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_normalizer.py sway_taste_engine/tests/test_profile_decay.py`
- [ ] **Task 2.3: Implement `normalizer.py` and update `profile.py`**
- [ ] **Task 2.4: Re-run tests to confirm green state**
- [ ] **Task 2.5: Commit**
  `git commit -m "feat(profile): implement telemetry normalizer and multi-horizon profile decay"`

---

### Phase 3: Real Metadata & Feature Provenance Extractor

**Objectives:**
- Build `extract_track_features(song) -> Track` in `metadata.py`.
- Ingest real factual attributes: title, multi-artist roles (singers vs composers vs lyricists), album, release year, duration, language, provider popularity.
- Populate derived features (`energy`, `bpm`, `moods`) with `FeatureValue` provenance. If unmeasured or unverified, keep `value=None` with `confidence=0.0`. Absolutely no synthetic `0.7` energy or `105` BPM defaults.
- Replace legacy `song_to_engine_track` across the backend.

**Files:**
- Create: `sway_taste_engine/sway_taste_engine/metadata.py`
- Modify: `music/app/routers/recommendations.py`
- Test: `sway_taste_engine/tests/test_metadata_extractor.py`

**Tasks:**
- [ ] **Task 3.1: Write tests for metadata extraction and feature provenance**
  - Test parsing multi-artist roles (e.g., "Pritam" identified as composer, "Atif Aslam" as primary singer).
  - Test release year extraction from `year` or `release_date`.
  - Test null-safety: verify unmeasured energy/bpm returns `FeatureValue(value=None, source="unmeasured", confidence=0.0)`.
  - Test that popular genre/mood heuristics provide explicit provenance tag `source="title_tag_heuristic"` with confidence <= 0.6.
- [ ] **Task 3.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_metadata_extractor.py`
- [ ] **Task 3.3: Implement `metadata.py` and update `recommendations.py`**
- [ ] **Task 3.4: Re-run tests to confirm green state**
- [ ] **Task 3.5: Commit**
  `git commit -m "feat(metadata): add dynamic metadata extractor with feature provenance and zero synthetic defaults"`

---

### Phase 4: Multi-Generator Candidate Retrieval Pipeline

**Objectives:**
- Create `CandidateBuilder` in `music/app/services/candidate_builder.py` aggregating 7 distinct candidate generators with explicit budgets:
  1. `same_artist`: budget 40
  2. `similar_artists`: budget 50
  3. `album_soundtrack`: budget 30
  4. `taste_neighbors`: budget 50
  5. `collaborative`: budget 50
  6. `discovery`: budget 50
  7. `exploration`: budget 30
- Total pool: 150–350 unique tracks, gathered concurrently via `asyncio.gather`.
- Deduplicate by canonical track ID while preserving multi-source provenance.

**Files:**
- Create: `music/app/services/candidate_builder.py`
- Modify: `music/app/routers/recommendations.py`
- Test: `music/tests/integration/test_candidate_builder.py`

**Tasks:**
- [ ] **Task 4.1: Write integration tests for candidate generation and budgeting**
  - Test that candidate builder with seed "Tu Chahiye" (Atif Aslam) produces >= 150 candidates.
  - Verify candidates contain songs by the same artist, similar artists (e.g. Arijit Singh, Mohit Chauhan), composer soundtrack songs (Pritam), and discovery tracks.
  - Verify generator budgets are respected and duplicates are deduplicated.
- [ ] **Task 4.2: Run tests to confirm red state**
  `pytest music/tests/integration/test_candidate_builder.py`
- [ ] **Task 4.3: Implement `CandidateBuilder` in `music/app/services/candidate_builder.py`**
- [ ] **Task 4.4: Re-run tests to confirm green state**
- [ ] **Task 4.5: Commit**
  `git commit -m "feat(retrieval): implement 300+ candidate multi-generator builder with strict budgeting"`

---

### Phase 5: Dynamic Precomputed Similarity Graph ($O(1)$ Retrieval)

**Objectives:**
- Create `SimilarityEngine` in `sway_taste_engine/similarity.py`:
  - Calculate multi-dimensional similarity: artist/composer overlap (Jaccard), release era proximity, language matching, and collaborative transition frequencies.
  - Precompute and store top-K (50–100) nearest neighbors in SQLite table `similarity_edges`.
- Update `SimilarTrackRetriever` and `SimilarArtistRetriever` in `retrieval.py` to query indexed edges directly from `SQLiteTasteStore` ($O(1)$ indexed retrieval).
- Eliminate empty similarity mappings forever.

**Files:**
- Create: `sway_taste_engine/sway_taste_engine/similarity.py`
- Modify: `sway_taste_engine/sway_taste_engine/retrieval.py`
- Test: `sway_taste_engine/tests/test_similarity.py`

**Tasks:**
- [ ] **Task 5.1: Write tests for similarity engine and indexed edge retrieval**
  - Verify similarity scoring between tracks sharing artist/composer/era (e.g. Atif Aslam 2015 romantic vs 2016 romantic ballad scores > 0.75).
  - Verify dissimilarity between acoustic ballads and club/electronic tracks.
  - Verify precomputed similarity edges are written to SQLite and retrieved in $O(1)$ by `SimilarTrackRetriever`.
  - Verify `SimilarArtistRetriever` returns related artists from persistent edges.
- [ ] **Task 5.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_similarity.py`
- [ ] **Task 5.3: Implement `similarity.py` and update `retrieval.py`**
- [ ] **Task 5.4: Re-run tests to confirm green state**
- [ ] **Task 5.5: Commit**
  `git commit -m "feat(similarity): implement precomputed similarity graph with O(1) edge retrieval"`

---

### Phase 6: Multi-Feature Score Ranker & Diversity Re-ranker

**Objectives:**
- Update `RuleBasedRanker` in `ranking.py` to use configurable weights from `RecommendationWeights`.
- Compute individual feature scores: `artist_affinity`, `track_similarity`, `session_fit`, `novelty`, `freshness`, `popularity`, `energy_fit`.
- Emit detailed component attribution (`ScoreBreakdown`) for every ranked item.
- Enforce negative memory pruning (drop disliked tracks/artists immediately).
- Update `DiversityReranker` in `diversity.py` with sliding-window constraints (max 2 consecutive tracks per artist, max 3 tracks per album in a 20-track window).

**Files:**
- Modify: `sway_taste_engine/sway_taste_engine/ranking.py`
- Modify: `sway_taste_engine/sway_taste_engine/diversity.py`
- Test: `sway_taste_engine/tests/test_ranking_explanations.py`, `sway_taste_engine/tests/test_diversity.py`

**Tasks:**
- [ ] **Task 6.1: Write tests for ranking explanations and diversity constraints**
  - Verify every ranked candidate contains an explainable component dictionary.
  - Verify explicit negative tracks/artists have score = 0 or are filtered out.
  - Verify diversity re-ranker breaks up artist clumps without sacrificing overall quality.
- [ ] **Task 6.2: Run tests to confirm red state**
  `pytest sway_taste_engine/tests/test_ranking_explanations.py sway_taste_engine/tests/test_diversity.py`
- [ ] **Task 6.3: Implement ranking and diversity enhancements**
- [ ] **Task 6.4: Re-run tests to confirm green state**
- [ ] **Task 6.5: Commit**
  `git commit -m "feat(ranking): implement explainable multi-feature ranker and sliding-window diversity re-ranker"`

---

### Phase 7: Product Surfaces & Policies (Home Shelves & Next Queue)

**Objectives:**
- Build `MixPlanner` in `sway_taste_engine/mix_planner.py` composing differentiated home shelves:
  - `Quick Mix`: 40% favorites, 25% similar artists, 20% taste, 15% discovery.
  - `Because You Listened To {Track}`: Direct similarity neighborhood of recent completed track.
  - `Artist Radar`: Focused shelf for top artist + collaborative contemporaries.
  - `Rediscover`: High-completion tracks from 14–60 days ago.
  - `Discover Mix`: High novelty tolerance pool.
- Implement `QueuePlanner` in `sway_taste_engine/queue_planner.py` optimizing transition sequence ($A \rightarrow B \rightarrow C$):
  $\text{Score}(A \rightarrow B) = 0.30 \cdot \text{mood\_continuity} + 0.25 \cdot \text{energy\_smoothness} + 0.20 \cdot \text{artist\_affinity} + 0.15 \cdot \text{transition\_graph} + 0.10 \cdot \text{novelty}$.
- Create endpoints:
  - `GET /api/v1/home` (multi-shelf feed with badges and editorial titles).
  - `GET /api/v1/queue/next` (sequence-optimized continuation queue).
  - Upgrade `GET /api/v1/recommendations` (track radio, artist radio, for you).

**Files:**
- Create: `sway_taste_engine/sway_taste_engine/mix_planner.py`
- Create: `sway_taste_engine/sway_taste_engine/queue_planner.py`
- Create: `music/app/routers/home.py`
- Create: `music/app/routers/queue.py`
- Modify: `music/app/routers/recommendations.py`
- Modify: `music/app/main.py`
- Test: `music/tests/integration/test_home_api.py`, `music/tests/integration/test_queue_api.py`, `sway_taste_engine/tests/test_queue_planner.py`

**Tasks:**
- [ ] **Task 7.1: Write tests for Home shelves and Next Queue transition planning**
  - Verify `/api/v1/home` returns 5 distinct shelves with non-empty tracks, badges, and artwork.
  - Verify `/api/v1/queue/next` from a slow romantic ballad selects compatible ballads, avoiding abrupt tempo/genre cliffs.
  - Verify historical transitions ($A \rightarrow B$) boost continuation scores.
- [ ] **Task 7.2: Run tests to confirm red state**
  `pytest music/tests/integration/test_home_api.py music/tests/integration/test_queue_api.py sway_taste_engine/tests/test_queue_planner.py`
- [ ] **Task 7.3: Implement `mix_planner.py`, `queue_planner.py`, `home.py`, and `queue.py`**
  - Register `home.router` and `queue.router` in `music/app/main.py`.
- [ ] **Task 7.4: Re-run tests to confirm green state**
- [ ] **Task 7.5: Commit**
  `git commit -m "feat(surfaces): implement multi-shelf home feed and sequence-optimized next queue"`

---

### Phase 8: Frontend Client Telemetry & Dynamic Home Shelves

**Objectives:**
- Create `sway-ui/lib/api/telemetry.ts` managing 3-tier identity:
  - Generate and persist `sway_anon_id` in `localStorage`.
  - Manage `sway_session_id` (`sess_<timestamp>_<random>`) with a 30-minute inactivity timeout.
  - Dispatch non-blocking telemetry events with beacon / batching support.
- Wire milestone telemetry in `sway-ui/lib/hooks/usePlayback.ts`:
  - Milestones: `play_10s`, `play_30s`, `play_50pct`, `completed`, `skip_lt_10s`, `skip_10_30s`.
  - Strictly decoupled: audio playback does not block on telemetry.
- Update `sway-ui/app/page.tsx` to consume `GET /api/v1/home` and render rich dynamic horizontal shelves.

**Files:**
- Create: `sway-ui/lib/api/telemetry.ts`
- Create: `sway-ui/lib/api/home.ts`
- Modify: `sway-ui/lib/hooks/usePlayback.ts`
- Modify: `sway-ui/app/page.tsx`
- Test: Next.js build verification (`npm run build` in `sway-ui`)

**Tasks:**
- [ ] **Task 8.1: Implement `telemetry.ts` and `home.ts` API clients**
  - Include 3-tier identity headers on every request (`x-sway-user-id`, `x-sway-anon-id`, `x-sway-session-id`).
- [ ] **Task 8.2: Wire milestone tracking in `usePlayback.ts`**
  - Track playback duration and completion percentage via ref ticks.
  - Fire milestone telemetry only once per track play.
- [ ] **Task 8.3: Update `sway-ui/app/page.tsx` for dynamic multi-shelf rendering**
  - Render Quick Mix hero, Because You Listened shelf, Artist Radar, and Rediscover shelves.
- [ ] **Task 8.4: Verify frontend build**
  `cd sway-ui && npm run build`
- [ ] **Task 8.5: Commit**
  `git commit -m "feat(ui): implement client telemetry milestones, session identity, and dynamic home shelves"`

---

### Phase 9: Observability, Shadow Mode & Regression Anchors

**Objectives:**
- Create `GET /api/v1/recommendations/debug` returning complete attribution for any recommendation query:
  - Candidate counts per generator.
  - Component score breakdowns (`taste`, `similarity`, `session`, `novelty`, `freshness`, `energy`).
  - Pruned negative tracks and reason for pruning.
- Implement Shadow Mode comparator: can execute V2 algorithm in parallel with legacy code, logging score distributions and candidate divergence without affecting client responses.
- Establish deterministic regression benchmark suite:
  - "Tu Chahiye" anchor test: asserts candidate pool >= 150, returns Atif Aslam contemporaries, Pritam soundtrack tracks, and zero hardcoded keywords.
  - "Transition Continuity" anchor test: asserts romantic acoustic track transitions to compatible tracks with smooth energy gradient.
  - 100% of existing tests in `music/` (100 tests) and `sway_taste_engine/` pass.

**Files:**
- Modify: `music/app/routers/recommendations.py`
- Create: `music/tests/integration/test_recommendations_debug.py`
- Create: `music/tests/integration/test_taste_regression_anchors.py`

**Tasks:**
- [ ] **Task 9.1: Write tests for debug attribution and regression anchors**
  - Verify `/api/v1/recommendations/debug` returns full component breakdown.
  - Verify "Tu Chahiye" test asserts >= 150 candidates and proper contemporary artists.
  - Verify queue transition test asserts smooth energy/tempo slope.
- [ ] **Task 9.2: Run tests to confirm red state**
  `pytest music/tests/integration/test_recommendations_debug.py music/tests/integration/test_taste_regression_anchors.py`
- [ ] **Task 9.3: Implement `/debug` endpoint and shadow mode comparator**
- [ ] **Task 9.4: Re-run all tests across backend and taste engine**
  `pytest music/` and `pytest sway_taste_engine/`
- [ ] **Task 9.5: Commit**
  `git commit -m "feat(observability): add recommendation debug endpoint, shadow mode, and regression anchors"`

---

## 4. Verification & Quality Gates

1. **Test Suite Gate:**
   - 100% of existing tests in `music/` (100 tests) must pass.
   - All newly added unit and integration tests across Phase 0–9 must pass.
2. **Quality Anchor Gate:**
   - Anchor track "Tu Chahiye" (Atif Aslam) produces >= 150 candidates without any hardcoded keywords.
   - Candidate pool contains Atif Aslam top tracks, Pritam soundtrack songs, and romantic Bollywood contemporaries.
3. **Queue Transition Gate:**
   - Next Queue from a mellow romantic ballad maintains mood and energy continuity without sudden EDM or disjoint genre jumps.
4. **End-to-End Runtime Gate:**
   - Web client at `http://localhost:3000` logs telemetry events to SQLite `music_recs.db` upon playing tracks.
   - `/api/v1/home` successfully populates personalized shelves on the Home page.
