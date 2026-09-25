# SWAY Taste Engine

A provider-agnostic, YouTube-Music-inspired recommendation engine for SWAY.

It implements the practical first version of a modern music recommender:

- event ingestion and idempotency
- long/medium/recent/session taste profiles
- recency decay
- artist/genre/language/mood/energy affinity
- completion/skip/replay signals
- multiple candidate retrievers
- personalized ranking
- novelty/exploration
- artist/album/genre/language diversity
- repetition and impression-fatigue penalties
- track radio / artist radio / discover / for-you / autoplay / new releases / trending
- cursor pagination for infinite feeds
- provider playability awareness
- recommendation attribution and explanations
- deterministic, explainable V1 ranker
- clean interfaces for future collaborative/vector/Transformer rankers
- FastAPI integration
- SQLite/PostgreSQL-friendly schema design via SQL migration

The engine is intentionally not coupled to JioSaavn or YouTube Music. Feed candidates are canonical SWAY tracks; provider availability is metadata on the track.

## Quick start

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .
pytest -q
uvicorn sway_taste_engine.api:create_app --factory --reload
```

Then open `http://127.0.0.1:8000/docs`.

## Architecture

```text
Events -> Profile Builder -> Candidate Retrieval -> Ranking -> Diversity -> Feed
                                             ^                         |
                                             |                         |
                                      Canonical Catalog <---------------
```

The V1 engine is intentionally deterministic so it can be tested and debugged. It is ready to swap individual retrievers and the ranker for ML components later.
