from __future__ import annotations

from typing import List, Optional
from .models import Track
from .storage import TasteStore


class SimilarityEngine:
    """Calculates multi-dimensional track similarity and precomputes Top-K edges in SQLite.

    Incorporates:
    - Primary and featured artist matching (Jaccard)
    - Soundtrack composer matching
    - Release era proximity
    - Language compatibility
    - Mood and genre tag matching (Jaccard)
    - Acoustic/energy compatibility
    """

    def compute_track_similarity(self, t1: Track, t2: Track) -> float:
        if t1.id == t2.id:
            return 1.0

        # 1. Artist overlap (weight: 0.35)
        names1 = {a.name.lower().strip() for a in t1.artists} if t1.artists else set()
        if t1.artist_name:
            names1.add(t1.artist_name.lower().strip())

        names2 = {a.name.lower().strip() for a in t2.artists} if t2.artists else set()
        if t2.artist_name:
            names2.add(t2.artist_name.lower().strip())

        if names1 and names2:
            artist_jaccard = len(names1 & names2) / len(names1 | names2)
            # If primary artist matches exactly, give high affinity
            if t1.artist_name and t2.artist_name and t1.artist_name.lower().strip() == t2.artist_name.lower().strip():
                artist_sim = 1.0
            else:
                artist_sim = artist_jaccard
        else:
            artist_sim = 0.0

        # 2. Composer overlap (weight: 0.15)
        comp1 = {c.lower().strip() for c in t1.composers} | {
            a.name.lower().strip()
            for a in t1.artists
            if a.role and ("composer" in a.role.lower() or "music" in a.role.lower())
        }
        comp2 = {c.lower().strip() for c in t2.composers} | {
            a.name.lower().strip()
            for a in t2.artists
            if a.role and ("composer" in a.role.lower() or "music" in a.role.lower())
        }
        if comp1 and comp2 and (comp1 & comp2):
            composer_sim = 1.0
        elif comp1 and comp2:
            composer_sim = len(comp1 & comp2) / len(comp1 | comp2)
        else:
            composer_sim = 0.0

        # 3. Era proximity (weight: 0.15)
        if t1.year and t2.year:
            diff = abs(t1.year - t2.year)
            era_sim = max(0.0, 1.0 - (diff / 15.0))
        else:
            era_sim = 0.5  # Neutral if release year unknown

        # 4. Language match (weight: 0.15)
        if t1.language and t2.language:
            lang_sim = 1.0 if t1.language.lower().strip() == t2.language.lower().strip() else 0.0
        else:
            lang_sim = 0.5

        # 5. Genre & Mood match (weight: 0.20)
        tags1 = {g.lower().strip() for g in t1.genres} | {m.lower().strip() for m in t1.moods}
        tags2 = {g.lower().strip() for g in t2.genres} | {m.lower().strip() for m in t2.moods}
        if tags1 and tags2:
            tag_sim = len(tags1 & tags2) / len(tags1 | tags2)
        else:
            tag_sim = 0.0

        base_score = (
            0.35 * artist_sim
            + 0.15 * composer_sim
            + 0.15 * era_sim
            + 0.15 * lang_sim
            + 0.20 * tag_sim
        )

        # 6. Energy compatibility adjustment (if both measured)
        if (
            t1.energy is not None
            and t2.energy is not None
            and t1.energy_feature.confidence > 0
            and t2.energy_feature.confidence > 0
        ):
            energy_sim = max(0.0, 1.0 - abs(t1.energy - t2.energy))
            final_score = 0.90 * base_score + 0.10 * energy_sim
        else:
            final_score = base_score

        return max(0.0, min(1.0, final_score))

    def compute_and_store_graph(
        self, tracks: List[Track], store: TasteStore, top_k: int = 50, min_score: float = 0.20
    ) -> None:
        """Precompute Top-K similarity edges for all given tracks and store in SQLite."""
        if not tracks or len(tracks) < 2:
            return

        all_edges: list[tuple[str, str, float, str]] = []

        for i, t1 in enumerate(tracks):
            scored: list[tuple[str, float]] = []
            for j, t2 in enumerate(tracks):
                if i == j:
                    continue
                score = self.compute_track_similarity(t1, t2)
                if score >= min_score:
                    scored.append((t2.id, score))

            scored.sort(key=lambda x: x[1], reverse=True)
            for to_id, score in scored[:top_k]:
                all_edges.append((t1.id, to_id, score, "content_similarity"))

        store.save_similarity_edges(all_edges)
