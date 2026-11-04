from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
import sqlite3
import time
from ..discovery.config import DiscoveryError

PATH = Path(__file__).resolve().parents[3] / ".local/menu-sources/requests.sqlite3"


class SourceJobLimits:
    def __init__(self, path=PATH, clock=time.time): self.path, self.clock = path, clock

    @contextmanager
    def _db(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with sqlite3.connect(self.path, timeout=3) as db:
                self.path.chmod(0o600)
                db.execute("CREATE TABLE IF NOT EXISTS source_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, started REAL NOT NULL, finished INTEGER NOT NULL DEFAULT 0)")
                db.execute("CREATE INDEX IF NOT EXISTS source_jobs_time ON source_jobs(started, owner)")
                db.execute("BEGIN IMMEDIATE")
                yield db
        except (OSError, sqlite3.Error):
            raise DiscoveryError(503, "Menu source limits are unavailable; website discovery is paused.") from None

    def reserve(self, user, request_id):
        owner, now = sha256(str(user).encode()).hexdigest(), self.clock()
        with self._db() as db:
            db.execute("DELETE FROM source_jobs WHERE started < ?", (now - 172800,))
            if db.execute("SELECT 1 FROM source_jobs WHERE id=?", (str(request_id),)).fetchone():
                raise DiscoveryError(409, "This source check already started. It will not be repeated automatically.")
            user_hour = db.execute("SELECT COUNT(*) FROM source_jobs WHERE owner=? AND started>?", (owner, now - 3600)).fetchone()[0]
            total_day = db.execute("SELECT COUNT(*) FROM source_jobs WHERE started>=?", (now // 86400 * 86400,)).fetchone()[0]
            active = db.execute("SELECT owner FROM source_jobs WHERE finished=0 AND started>?", (now - 90,)).fetchall()
            if user_hour >= 5 or total_day >= 30 or len(active) >= 2 or any(row[0] == owner for row in active):
                raise DiscoveryError(429, "Menu source discovery has reached its request limit. Please try later.")
            db.execute("INSERT INTO source_jobs(id,owner,started) VALUES (?,?,?)", (str(request_id), owner, now))

    def finish(self, request_id):
        with self._db() as db: db.execute("UPDATE source_jobs SET finished=1 WHERE id=?", (str(request_id),))

    def reserve_upload(self, user, request_id):
        """Bound local parsing separately from billable/remote website jobs."""
        owner, now = sha256(str(user).encode()).hexdigest(), self.clock()
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS upload_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, started REAL NOT NULL, finished INTEGER NOT NULL DEFAULT 0)")
            db.execute("CREATE INDEX IF NOT EXISTS upload_jobs_time ON upload_jobs(started, owner)")
            db.execute("DELETE FROM upload_jobs WHERE started < ?", (now - 172800,))
            if db.execute("SELECT 1 FROM upload_jobs WHERE id=?", (str(request_id),)).fetchone():
                raise DiscoveryError(409, "This menu upload already started. It will not be repeated automatically.")
            user_hour = db.execute("SELECT COUNT(*) FROM upload_jobs WHERE owner=? AND started>?", (owner, now - 3600)).fetchone()[0]
            total_day = db.execute("SELECT COUNT(*) FROM upload_jobs WHERE started>=?", (now // 86400 * 86400,)).fetchone()[0]
            active = db.execute("SELECT owner FROM upload_jobs WHERE finished=0 AND started>?", (now - 90,)).fetchall()
            if user_hour >= 5 or total_day >= 30 or len(active) >= 2 or any(row[0] == owner for row in active):
                raise DiscoveryError(429, "Menu uploads have reached their request limit. Please try later.")
            db.execute("INSERT INTO upload_jobs(id,owner,started) VALUES (?,?,?)", (str(request_id), owner, now))

    def finish_upload(self, request_id):
        with self._db() as db: db.execute("UPDATE upload_jobs SET finished=1 WHERE id=?", (str(request_id),))
