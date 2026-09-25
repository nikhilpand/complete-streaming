from __future__ import annotations
from collections import defaultdict
from threading import RLock
from .models import Track, UserEvent, UserTasteProfile

class InMemoryStore:
    """Thread-safe development store. Replace with repository adapters for production DBs."""
    def __init__(self) -> None:
        self._lock = RLock()
        self.tracks: dict[str, Track] = {}
        self.events: dict[str, UserEvent] = {}
        self.events_by_user: dict[str, list[str]] = defaultdict(list)
        self.profiles: dict[str, UserTasteProfile] = {}
        self.recommendation_impressions: dict[str, int] = defaultdict(int)
        self.session_events: dict[str, list[str]] = defaultdict(list)
    def upsert_track(self, track: Track) -> None:
        with self._lock: self.tracks[track.id] = track
    def upsert_tracks(self, tracks: list[Track]) -> None:
        with self._lock:
            for track in tracks: self.tracks[track.id] = track
    def get_track(self, track_id: str) -> Track | None: return self.tracks.get(track_id)
    def all_tracks(self) -> list[Track]: return list(self.tracks.values())
    def add_event(self, event: UserEvent) -> bool:
        with self._lock:
            if event.event_id in self.events: return False
            self.events[event.event_id] = event
            self.events_by_user[event.user_id].append(event.event_id)
            self.session_events[event.session_id].append(event.event_id)
            return True
    def user_events(self, user_id: str) -> list[UserEvent]:
        return [self.events[i] for i in self.events_by_user.get(user_id, [])]
    def session_events_for(self, session_id: str) -> list[UserEvent]:
        return [self.events[i] for i in self.session_events.get(session_id, [])]
    def get_profile(self, user_id: str) -> UserTasteProfile:
        with self._lock:
            if user_id not in self.profiles: self.profiles[user_id] = UserTasteProfile(user_id=user_id)
            return self.profiles[user_id]
    def save_profile(self, profile: UserTasteProfile) -> None:
        with self._lock: self.profiles[profile.user_id] = profile
