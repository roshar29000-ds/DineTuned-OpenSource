"""Private, conservative spending guard for the owner-approved local MVP validation.

This ledger is independent of provider ledgers and does not represent a billing cap.
Reservations count at their full upper estimate, including failed/unknown calls.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import uuid4
import os
import sqlite3

from .culinary.errors import CulinaryError

ROOT = Path(__file__).resolve().parents[2] / '.local' / 'validation-spend'
LIMIT = Decimal('3.00')
BUFFER = Decimal('0.25')


class ValidationSpend:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root)

    @classmethod
    def from_environment(cls):
        return cls() if os.getenv('DINETUNED_VALIDATION_PHASE_ENABLED') == 'true' else None

    def _connect(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.root / 'usage.sqlite3'
        if path.is_symlink():
            raise CulinaryError('validation_budget', 'The validation spending ledger is unavailable.')
        db = sqlite3.connect(path, timeout=10)
        os.chmod(path, 0o600)
        db.execute('''CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
            purpose TEXT NOT NULL, upper_usd TEXT NOT NULL, status TEXT NOT NULL,
            actual_estimated_usd TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        return db

    def reserve(self, provider: str, model: str, purpose: str, upper_usd: Decimal) -> str:
        try: amount = Decimal(upper_usd)
        except (InvalidOperation, TypeError): amount = Decimal('-1')
        if not amount.is_finite() or amount <= 0 or not provider or not model or not purpose:
            raise CulinaryError('validation_budget', 'The request cost cannot be estimated reliably.')
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                rows = db.execute('SELECT upper_usd, status FROM requests').fetchall()
                used = sum((Decimal(value) for value, status in rows if status != 'cancelled'), Decimal(0))
                if used + amount > LIMIT - BUFFER:
                    raise CulinaryError('validation_budget', 'The owner-approved validation spending limit would be exceeded.')
                request_id, now = str(uuid4()), datetime.now(timezone.utc).isoformat()
                db.execute('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?)',
                    (request_id, provider, model, purpose, str(amount), 'pending', None, now, now))
                return request_id
        except sqlite3.Error:
            raise CulinaryError('validation_budget', 'The validation spending ledger is unavailable.') from None

    def finish(self, request_id: str, status: str, actual_estimated_usd: Decimal | None = None):
        if status not in {'success', 'failed', 'unknown', 'cancelled'}:
            raise ValueError('Invalid validation spending status')
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                updated = db.execute('UPDATE requests SET status=?, actual_estimated_usd=?, updated_at=? WHERE id=? AND status=?',
                    (status, str(actual_estimated_usd) if actual_estimated_usd is not None else None,
                     datetime.now(timezone.utc).isoformat(), request_id, 'pending'))
                if updated.rowcount != 1:
                    raise CulinaryError('validation_budget', 'The validation spending reservation could not be reconciled.')
        except sqlite3.Error:
            raise CulinaryError('validation_budget', 'The validation spending ledger is unavailable.') from None

    def summary(self):
        with self._connect() as db:
            rows = db.execute('SELECT provider, model, purpose, upper_usd, status, actual_estimated_usd FROM requests ORDER BY created_at').fetchall()
        used = sum((Decimal(row[3]) for row in rows if row[4] != 'cancelled'), Decimal(0))
        return {'upper_accounted_usd': used, 'remaining_preflight_usd': LIMIT - BUFFER - used,
                'requests': rows}
