"""Durable, atomic reservations. Counts include failed/aborted requests; never retry.

One shared local file covers all backend workers on this host. No Places content is
cached. A distributed deployment must share limits or use a central limiter.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import sqlite3
import time
from uuid import uuid4
from .config import DiscoveryError
from .models import DiscoverySession


class DiscoveryLimits:
    TTL = 300
    SESSION_REQUESTS = 8
    GLOBAL_DAILY = {"session": 20, "autocomplete": 50, "details": 5}
    USER_DAILY = {"session": 10, "autocomplete": 40, "details": 3}
    USER_MINUTE = {"session": 3, "autocomplete": 12, "details": 2}

    def __init__(self, path: Path, clock=time.time, *, controlled_test_id: str | None = None,
                 extra_controlled_details: bool = False):
        self.path, self.clock = path, clock
        self.controlled_test_id = self.digest(controlled_test_id) if controlled_test_id else None
        self.extra_controlled_details = bool(extra_controlled_details and controlled_test_id)

    @contextmanager
    def transaction(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with sqlite3.connect(self.path, timeout=3) as db:
                self.path.chmod(0o600)
                db.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL, calls INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)")
                db.execute("CREATE TABLE IF NOT EXISTS requests (owner TEXT NOT NULL, kind TEXT NOT NULL, at REAL NOT NULL)")
                db.execute("CREATE INDEX IF NOT EXISTS requests_at ON requests(at, kind, owner)")
                db.execute("CREATE TABLE IF NOT EXISTS predictions (token TEXT NOT NULL, place_id TEXT NOT NULL, PRIMARY KEY(token, place_id))")
                # Never purge one-use grants. A restart, expiry or UTC-day change
                # must not authorize another paid call for the same test ID.
                db.execute("CREATE TABLE IF NOT EXISTS controlled_tests (run_id TEXT PRIMARY KEY, owner TEXT NOT NULL, token TEXT NOT NULL, autocomplete INTEGER NOT NULL DEFAULT 0, details INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL)")
                db.execute("BEGIN IMMEDIATE")
                now = self.clock()
                db.execute("DELETE FROM predictions WHERE token IN (SELECT token FROM sessions WHERE expires <= ?)", (now,))
                db.execute("DELETE FROM sessions WHERE expires <= ?", (now,))
                # Only operational counters, not a financial ledger. Retain two days.
                db.execute("DELETE FROM requests WHERE at < ?", (now - 172800,))
                yield db, now
        except (sqlite3.Error, OSError):
            raise DiscoveryError(503, "Restaurant search limits are unavailable. Search is paused to protect usage.") from None

    @staticmethod
    def digest(value):
        return sha256(str(value).encode()).hexdigest()

    def _reserve(self, db, now, owner, kind, *, extra_global=0):
        day = now // 86400 * 86400
        global_count = db.execute("SELECT COUNT(*) FROM requests WHERE kind=? AND at>=?", (kind, day)).fetchone()[0]
        daily = db.execute("SELECT COUNT(*) FROM requests WHERE kind=? AND owner=? AND at>=?", (kind, owner, day)).fetchone()[0]
        minute = db.execute("SELECT COUNT(*) FROM requests WHERE kind=? AND owner=? AND at>?", (kind, owner, now - 60)).fetchone()[0]
        if global_count >= self.GLOBAL_DAILY[kind] + extra_global or daily >= self.USER_DAILY[kind] or minute >= self.USER_MINUTE[kind]:
            raise DiscoveryError(429, "Restaurant search has reached its request limit. Please try later or explore the fictional demo.")
        db.execute("INSERT INTO requests VALUES (?, ?, ?)", (owner, kind, now))

    def start(self, user):
        token = uuid4()
        with self.transaction() as (db, now):
            owner = self.digest(user)
            if self.controlled_test_id and db.execute("SELECT 1 FROM controlled_tests WHERE run_id=?", (self.controlled_test_id,)).fetchone():
                raise DiscoveryError(429, "This controlled Google test already used its one search session. No further Google request was made.")
            self._reserve(db, now, owner, "session")
            db.execute("INSERT INTO sessions(token, owner, expires) VALUES (?, ?, ?)", (self.digest(token), owner, now + self.TTL))
            if self.controlled_test_id:
                db.execute("INSERT INTO controlled_tests(run_id, owner, token, created) VALUES (?, ?, ?, ?)",
                           (self.controlled_test_id, owner, self.digest(token), now))
        return DiscoverySession(session_token=token, expires_at=datetime.fromtimestamp(now + self.TTL, timezone.utc),
                                request_limit=1 if self.controlled_test_id else self.SESSION_REQUESTS)

    def reserve(self, user, token, kind, place_id=None):
        if kind not in ("autocomplete", "details"):
            raise ValueError("Unsupported discovery request kind")
        owner, key = self.digest(user), self.digest(token)
        with self.transaction() as (db, now):
            row = db.execute("SELECT owner, expires, calls, consumed FROM sessions WHERE token=?", (key,)).fetchone()
            if not row or row[0] != owner or row[1] <= now or row[3]:
                raise DiscoveryError(409, "This search session ended. Start a new search before choosing a branch.")
            if kind == "autocomplete" and row[2] >= self.SESSION_REQUESTS:
                raise DiscoveryError(409, "This search session reached its limit. Start a new search to continue.")
            if kind == "details" and not db.execute("SELECT 1 FROM predictions WHERE token=? AND place_id=?", (key, place_id)).fetchone():
                raise DiscoveryError(422, "Choose a branch returned in this search session.")
            grant = None
            if self.controlled_test_id:
                grant = db.execute("SELECT owner, token, autocomplete, details FROM controlled_tests WHERE run_id=?", (self.controlled_test_id,)).fetchone()
                if not grant or grant[0] != owner or grant[1] != key:
                    raise DiscoveryError(409, "This controlled Google test belongs to a different verified search session.")
                if (kind == "autocomplete" and grant[2]) or (kind == "details" and (not grant[2] or grant[3])):
                    raise DiscoveryError(429, "This controlled Google test already used its one request of this type. No further Google request was made.")
            # At most one extra global Details request for this exact fresh
            # one-use grant. All per-user and minute limits remain unchanged.
            extra_global = 1 if (kind == 'details' and self.extra_controlled_details
                                 and grant and grant[2] == 1 and grant[3] == 0) else 0
            self._reserve(db, now, owner, kind, extra_global=extra_global)
            if self.controlled_test_id:
                column = "autocomplete" if kind == "autocomplete" else "details"
                db.execute(f"UPDATE controlled_tests SET {column}={column}+1 WHERE run_id=?", (self.controlled_test_id,))
            if kind == "details":
                db.execute("UPDATE sessions SET consumed=1 WHERE token=?", (key,))
            else:
                db.execute("UPDATE sessions SET calls=calls+1 WHERE token=?", (key,))

    def remember_ids(self, token, place_ids):
        # Only IDs, which are exempt from Places content caching restrictions.
        with self.transaction() as (db, _):
            key = self.digest(token)
            if db.execute("SELECT 1 FROM sessions WHERE token=? AND consumed=0", (key,)).fetchone():
                db.executemany("INSERT OR IGNORE INTO predictions VALUES (?, ?)", [(key, value) for value in place_ids])
