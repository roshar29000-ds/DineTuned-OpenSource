"""Owner-gated real-menu inference with durable, guest-scoped idempotency.

This module is dormant unless the owner sets every production approval variable.
The shared Meta ledger remains the final spending gate; this cache prevents a
repeat of the same signed menu and preference context from charging again.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
import os
import re
import sqlite3
from uuid import UUID

from ..culinary.errors import CulinaryError
from ..culinary.meta import LiveConsent
from ..usage_budget import CUMULATIVE_LIMIT, UsageBudget
from .models import RealProviderOutput
from .provider import MetaRealMenuProvider

CACHE_PATH = Path(__file__).resolve().parents[3] / '.local' / 'real_picks' / 'proposals.sqlite3'
MILESTONE = '4D.PROD'


@dataclass(frozen=True)
class ProductionPolicy:
    cap_usd: Decimal
    max_attempts: int
    daily_per_guest: int

    @classmethod
    def from_environment(cls):
        if os.getenv('DINETUNED_META_PRODUCTION_ENABLED') != 'true':
            return None
        try:
            approval = os.getenv('DINETUNED_META_PRODUCTION_APPROVAL_ID', '')
            cap = Decimal(os.getenv('DINETUNED_META_PRODUCTION_CAP_USD', ''))
            attempts = int(os.getenv('DINETUNED_META_PRODUCTION_MAX_ATTEMPTS', ''))
            daily = int(os.getenv('DINETUNED_META_PRODUCTION_DAILY_PER_GUEST', ''))
        except (ValueError, InvalidOperation):
            raise CulinaryError('production_disabled', 'Production inference lacks a complete owner-approved spending policy.') from None
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', approval) or not cap.is_finite() or not 0 < cap <= CUMULATIVE_LIMIT \
                or not 0 < attempts <= 100 or not 0 < daily <= 10 or not os.getenv('MODEL_API_KEY'):
            raise CulinaryError('production_disabled', 'Production inference lacks a complete owner-approved spending policy.')
        return cls(cap_usd=cap, max_attempts=attempts, daily_per_guest=daily)


class ProductionProposalCache:
    def __init__(self, path: Path = CACHE_PATH): self.path = Path(path)

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink():
            raise CulinaryError('cache_unavailable', 'The private recommendation cache is unavailable.')
        db = sqlite3.connect(self.path, timeout=5)
        os.chmod(self.path, 0o600)
        db.execute('''CREATE TABLE IF NOT EXISTS proposals (
            guest_id TEXT NOT NULL, context_digest TEXT NOT NULL, created_day TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
            output TEXT, PRIMARY KEY(guest_id, context_digest))''')
        db.execute('CREATE INDEX IF NOT EXISTS proposals_guest_day ON proposals(guest_id, created_day)')
        return db

    def start_or_get(self, guest: UUID, digest: str, daily_limit: int):
        if not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise CulinaryError('invalid_context', 'The recommendation context could not be identified.')
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT status, output FROM proposals WHERE guest_id=? AND context_digest=?',
                    (str(guest), digest)).fetchone()
                if row:
                    if row[0] == 'ready' and row[1]:
                        try: return RealProviderOutput.model_validate_json(row[1])
                        except ValueError: raise CulinaryError('cache_invalid', 'The saved recommendation cannot be validated; no new model request was made.') from None
                    raise CulinaryError('request_pending', 'This exact recommendation request has already been attempted. No new model call was made.')
                day = datetime.now(timezone.utc).date().isoformat()
                count = db.execute('SELECT COUNT(*) FROM proposals WHERE guest_id=? AND created_day=?', (str(guest), day)).fetchone()[0]
                if count >= daily_limit:
                    raise CulinaryError('guest_limit', 'Your daily AI recommendation limit has been reached; no model request was made.')
                db.execute('INSERT INTO proposals VALUES (?,?,?,?,NULL)', (str(guest), digest, day, 'pending'))
            return None
        except sqlite3.Error:
            raise CulinaryError('cache_unavailable', 'The private recommendation cache is unavailable; no model request was made.') from None

    def finish(self, guest: UUID, digest: str, output: RealProviderOutput | None):
        # A failed save leaves the pending row, blocking a duplicate billable call.
        try:
            with self._connect() as db:
                db.execute('UPDATE proposals SET status=?, output=? WHERE guest_id=? AND context_digest=? AND status=?',
                    ('ready' if output else 'failed', output.model_dump_json() if output else None, str(guest), digest, 'pending'))
        except sqlite3.Error:
            raise CulinaryError('cache_unavailable', 'The model result could not be safely cached. No automatic retry is allowed.') from None


class ProductionRealProvider:
    def __init__(self, guest: UUID, policy: ProductionPolicy, *, cache: ProductionProposalCache | None = None, delegate=None,
                 budget: UsageBudget | None = None):
        self.guest, self.policy = guest, policy
        self.cache = cache or ProductionProposalCache()
        self.budget = budget or UsageBudget(extra_limits={MILESTONE: (policy.cap_usd, policy.max_attempts)})
        self.delegate = delegate or MetaRealMenuProvider(milestone=MILESTONE,
            consent=LiveConsent(live=True, confirm_spend=True), budget=self.budget)

    def propose(self, context):
        cached = self.cache.start_or_get(self.guest, context.digest, self.policy.daily_per_guest)
        if cached is not None:
            return cached
        try:
            output = self.delegate.propose(context)
            if output.mode != 'meta':
                raise CulinaryError('invalid_provider', 'The production provider did not return real Meta inference.')
        except Exception:
            self.cache.finish(self.guest, context.digest, None)
            raise
        self.cache.finish(self.guest, context.digest, output)
        return output
