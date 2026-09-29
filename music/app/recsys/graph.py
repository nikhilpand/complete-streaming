"""Own item-item co-listening graph (the data flywheel that reduces dependence on YTM/Saavn).

Design follows ListenBrainz's similar-artist job: split listens into sessions by a max gap, count
co-occurrence inside a small window, cap each user's contribution to any pair, and keep only pairs
above a threshold. Recommendation-driven listens (organic=0) count less so the graph does not just
learn our own output (the lesson of the Yambda `is_organic` flag).
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Optional

from .config import Settings
from .store import Store


def build_graph(store: Store, s: Settings, days: float = 60.0, now: Optional[float] = None) -> int:
    now = now or time.time()
    rows = store.iter_graph_events(now - days * 86400)
    edges: dict[tuple[str, str], float] = defaultdict(float)

    def flush(seq: list[tuple[str, float]], out: dict):
        for i in range(len(seq)):
            for j in range(i + 1, min(i + 1 + s.graph_window, len(seq))):
                (a, _), (b, wb) = seq[i], seq[j]
                if a == b:
                    continue
                w = wb / (j - i)
                for pair in ((a, b), (b, a)):
                    out[pair] = min(out.get(pair, 0.0) + w, s.graph_per_user_cap)

    cur_user, last_ts = None, 0.0
    seq: list[tuple[str, float]] = []
    per_user: dict[tuple[str, str], float] = {}

    def close_user():
        nonlocal seq, per_user
        flush(seq, per_user)
        for pair, w in per_user.items():
            edges[pair] += w
        seq, per_user = [], {}

    for user, ts, tid, kind, pos, organic in rows:
        if kind == "skip" and pos < s.early_skip_ms:
            continue                                   # early skip = negative, not co-listening
        if user != cur_user:
            if cur_user is not None:
                close_user()
            cur_user, last_ts = user, ts
        elif ts - last_ts > s.graph_session_gap_s:
            flush(seq, per_user)                       # session boundary (per-user cap persists)
            seq = []
        last_ts = ts
        seq.append((tid, 1.0 if organic else 0.3))
    if cur_user is not None:
        close_user()

    by_a: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for (a, b), w in edges.items():
        if w >= s.graph_min_weight:
            by_a[a].append((b, w))
    final = []
    for a, nbrs in by_a.items():
        nbrs.sort(key=lambda x: x[1], reverse=True)
        final.extend((a, b, w) for b, w in nbrs[: s.graph_max_neighbors])
    store.replace_edges(final)
    return len(final)


def main() -> None:  # python -m app.recsys.graph   (run from cron, e.g. hourly)
    s = Settings()
    store = Store(s.db_path)
    print(f"graph edges written: {build_graph(store, s)}")


if __name__ == "__main__":
    main()
