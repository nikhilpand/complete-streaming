from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from .clients.ytm import RadioCursor


@dataclass
class Session:
    id: str
    user: Optional[str]
    touched: float = field(default_factory=time.monotonic)
    served_ids: set = field(default_factory=set)      # saavn ids already put in a queue this session
    served_keys: set = field(default_factory=set)     # dedupe keys (catches same song, different id)
    seed_saavn_id: Optional[str] = None
    seed_ytm_id: Optional[str] = None
    chip_id: str = "all"
    cursor: Optional[RadioCursor] = None

    def mark_served(self, cands) -> None:
        for c in cands:
            if c.saavn_id:
                self.served_ids.add(c.saavn_id)
            self.served_keys.add(c.key)
        if len(self.served_ids) > 1500:  # bound memory on marathon sessions
            self.served_ids.clear()
            self.served_keys.clear()
            self.mark_served(cands)


class SessionStore:
    def __init__(self, ttl_s: float = 6 * 3600, max_sessions: int = 20000):
        self._d: dict[str, Session] = {}
        self._ttl, self._max = ttl_s, max_sessions

    def _gc(self) -> None:
        if len(self._d) < self._max:
            return
        cutoff = time.monotonic() - self._ttl
        for sid in [s for s, v in self._d.items() if v.touched < cutoff]:
            del self._d[sid]
        while len(self._d) >= self._max:  # still full: evict oldest
            del self._d[min(self._d, key=lambda k: self._d[k].touched)]

    def get(self, session_id: Optional[str]) -> Optional[Session]:
        s = self._d.get(session_id) if session_id else None
        if s and time.monotonic() - s.touched > self._ttl:
            del self._d[session_id]
            return None
        if s:
            s.touched = time.monotonic()
        return s

    def get_or_create(self, session_id: Optional[str], user: Optional[str]) -> Session:
        s = self.get(session_id)
        if s:
            return s
        self._gc()
        s = Session(id=session_id or uuid.uuid4().hex[:16], user=user)
        self._d[s.id] = s
        return s
