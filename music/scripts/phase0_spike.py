"""Phase-0 spike: run against REAL YTM + Saavn before trusting the pipeline.

    python -m scripts.phase0_spike            # uses the built-in seed list
    python -m scripts.phase0_spike seeds.txt  # one "title | artist" per line

Prints, per seed and in aggregate:
  * resolve rate   (% of YTM radio tracks that map to a confident Saavn track)  <- go/no-go, want >= 70%
  * overlap        (YTM radio vs Saavn reco agreement)                          <- how much fusion helps
  * latency        (cold, then warm)
and saves the raw YTM `next` responses to fixtures/ so tests can replay them and a nightly canary can
detect schema drift. If a step prints 0 tracks, the unofficial response shape changed: inspect the fixture.
"""
from __future__ import annotations

import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

from app.recsys import Settings, build_engine
from app.recsys.clients.ytm import build_radio_body
from app.recsys.matching import match_score

SEEDS = [
    ("Tum Hi Ho", "Arijit Singh"), ("Kesariya", "Arijit Singh"), ("Excuses", "AP Dhillon"),
    ("Brown Munde", "AP Dhillon"), ("Despacito", "Luis Fonsi"), ("Shape of You", "Ed Sheeran"),
    ("Kal Ho Naa Ho", "Sonu Nigam"), ("Chaiyya Chaiyya", "Sukhwinder Singh"), ("Naatu Naatu", "Rahul Sipligunj"),
    ("Srivalli", "Javed Ali"), ("Ranjha", "B Praak"), ("Apna Bana Le", "Arijit Singh"),
]


def load_seeds() -> list[tuple[str, str]]:
    if len(sys.argv) > 1:
        return [tuple(x.strip() for x in ln.split("|", 1)) for ln in Path(sys.argv[1]).read_text().splitlines() if "|" in ln]
    return SEEDS


async def main() -> None:
    s = Settings(db_path=":memory:")
    engine, _ = build_engine(s)
    Path("fixtures").mkdir(exist_ok=True)
    resolve_rates, overlaps, cold_ms, warm_ms = [], [], [], []
    for title, artist in load_seeds():
        found = await engine.saavn.search_songs(f"{title} {artist}", limit=3)
        best = max(found, key=lambda c: match_score(c, type(found[0])(title=title, artists=[artist]))) if found else None
        if not best:
            print(f"[skip] no Saavn match for {title!r}")
            continue
        seed = await engine.load_seed(best.saavn_id)
        if not seed.ytm_video_id:
            print(f"[warn] {title!r}: could not map seed to a YTM videoId")
            continue
        # raw fixture (what the parser must survive)
        try:
            body = build_radio_body(seed.ytm_video_id)
            raw = await asyncio.to_thread(lambda: engine.ytm._client()._send_request("next", body))
            Path(f"fixtures/next_{seed.ytm_video_id}.json").write_text(json.dumps(raw)[:2_000_000])
        except Exception as e:  # noqa: BLE001
            print(f"[warn] raw fixture failed: {e!r}")
        page = await engine.ytm.radio_page(seed.ytm_video_id)
        reco = await engine.saavn.recommendations(seed.saavn_id, 25)
        ytm_ids = {t.ytm_video_id for t in page.tracks}
        await engine._resolve_pool([t for t in page.tracks])
        resolved = [t for t in page.tracks if t.saavn_id]
        rate = len(resolved) / max(len(page.tracks), 1)
        reco_ids = {c.saavn_id for c in reco}
        ov = len({t.saavn_id for t in resolved} & reco_ids) / max(min(len(resolved), len(reco_ids)), 1)
        engine.sessions = type(engine.sessions)()
        t0 = time.perf_counter(); r = await engine.radio(track_id=seed.saavn_id, limit=25); cold = (time.perf_counter() - t0) * 1000
        engine.sessions = type(engine.sessions)()
        t0 = time.perf_counter(); await engine.radio(track_id=seed.saavn_id, limit=25); warm = (time.perf_counter() - t0) * 1000
        resolve_rates.append(rate); overlaps.append(ov); cold_ms.append(cold); warm_ms.append(warm)
        print(f"{title[:22]:22} ytm={len(page.tracks):3} chips={len(page.chips)} cursor={'y' if page.cursor else 'n'} "
              f"resolve={rate:5.0%} saavn_reco={len(reco):2} overlap={ov:4.0%} out={len(r['tracks']):2} "
              f"cold={cold:5.0f}ms warm={warm:4.0f}ms")
    if resolve_rates:
        print("\n=== AGGREGATE ===")
        print(f"resolve rate  mean={statistics.mean(resolve_rates):.0%}  min={min(resolve_rates):.0%}   (go/no-go: >= 70%)")
        print(f"ytm∩saavn overlap mean={statistics.mean(overlaps):.0%}")
        print(f"latency cold p50={statistics.median(cold_ms):.0f}ms  warm p50={statistics.median(warm_ms):.0f}ms")


if __name__ == "__main__":
    asyncio.run(main())
