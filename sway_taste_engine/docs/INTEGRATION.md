# Integrating into SWAY

This package is a complete V1 recommendation engine, intentionally provider-agnostic.

Production integration:
1. Replace `InMemoryStore` with adapters around SWAY PostgreSQL/Redis repositories.
2. Convert canonical SWAY tracks into the `Track` model. Provider availability can include `{jiosaavn: true, youtube: true}`.
3. Send player, search, like, dislike, save, skip, completion and recommendation-impression events into `RecommendationEngine.ingest_event()` asynchronously.
4. Persist profiles and events using `sql/001_recommendation_schema.sql`.
5. Supply real track/artist similarity maps from SWAY's canonical music graph.
6. Later replace similarity maps with pgvector/ANN retrieval and a learned ranker.

The recommendation layer should never import JioSaavn or YouTube Music implementations. Playback/provider selection remains separate.
