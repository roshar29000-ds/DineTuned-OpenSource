"""Local, conservative cost accounting. This is NOT a provider billing cap.

Reserve before transport, reconcile after transport; an interrupted/unknown call
keeps its entire reservation. One locked, cumulative ledger spans 4D milestones.
No prompt, response, credential, or personal data is stored here.
"""
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import tempfile
from typing import Literal
from uuid import uuid4

from pydantic import Field, StrictInt, ValidationError, model_validator
from .schemas import Contract
from .culinary.errors import CulinaryError

MODEL = "muse-spark-1.3"
PRICING_SOURCE = "https://dev.meta.ai/docs/pricing-rate-limits"
PRICE_VERIFIED = date(2026, 10, 28)
PRICE_EXPIRES = date(2026, 11, 5)
INPUT_PER_MILLION = Decimal("1.25")
OUTPUT_PER_MILLION = Decimal("4.25")
CUMULATIVE_LIMIT = Decimal("10")
# Future milestones must register a policy here, without replacing the ledger.
# Existing ledger entries still count; this does not authorize automatic calls.
# One separately approved 4D.5A test may be attempted from the loopback-only
# developer runner. Policy alone never enables the production API or makes a call.
MILESTONES = {"4D.1": (Decimal("1"), 2), "4D.5A": (Decimal("1"), 1)}
LEDGER_PATH = Path(__file__).resolve().parents[2] / ".local" / "meta" / "usage.json"
MAX_REQUEST_BYTES = 24000
# Shared reasoning + visible JSON budget. At Standard prices, the extra 1536
# tokens add at most $0.006528 to the output reservation, not a new attempt.
MAX_OUTPUT_TOKENS = 3072


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def token_cost(input_tokens: int, output_tokens: int) -> Decimal:
    return (Decimal(input_tokens) * INPUT_PER_MILLION + Decimal(output_tokens) * OUTPUT_PER_MILLION) / 1_000_000


class CostEstimate(Contract):
    model: Literal["muse-spark-1.3"]
    input_tokens_upper: StrictInt = Field(ge=1)
    max_output_tokens: StrictInt = Field(ge=1, le=MAX_OUTPUT_TOKENS)
    request_bytes: StrictInt = Field(ge=1, le=MAX_REQUEST_BYTES)
    upper_usd: Decimal = Field(gt=0)
    input_per_million: Decimal = Field(gt=0)
    output_per_million: Decimal = Field(gt=0)
    pricing_verified: str
    pricing_source: str

    def cost(self, input_tokens: int, output_tokens: int) -> Decimal:
        return (Decimal(input_tokens) * self.input_per_million + Decimal(output_tokens) * self.output_per_million) / 1_000_000


class TokenUsage(Contract):
    input_tokens: StrictInt = Field(ge=0)
    output_tokens: StrictInt = Field(ge=0)
    total_tokens: StrictInt = Field(ge=0)
    cached_input_tokens: StrictInt = Field(default=0, ge=0)
    reasoning_tokens: StrictInt = Field(default=0, ge=0)

    @model_validator(mode="after")
    def consistent(self):
        if (self.total_tokens != self.input_tokens + self.output_tokens
                or self.cached_input_tokens > self.input_tokens or self.reasoning_tokens > self.output_tokens):
            raise ValueError("Inconsistent reported usage")
        return self


class Entry(Contract):
    id: str
    milestone: str
    created_at: str
    updated_at: str
    estimate: CostEstimate
    status: Literal["pending", "success", "invalid_output", "provider_error", "unknown_usage"]
    usage: TokenUsage | None = None
    usage_estimated_usd: Decimal | None = Field(default=None, ge=0)
    accounted_usd: Decimal = Field(ge=0)
    upper_bound_exceeded: bool = False
    pricing_uncertain: bool = False
    reported_model: str | None = None


class ImageCostEstimate(Contract):
    model: Literal['muse-image-1.0'] = 'muse-image-1.0'
    image_count: Literal[1] = 1
    usd_per_image: Decimal = Decimal('0.01')
    upper_usd: Decimal = Decimal('0.01')
    pricing_verified: str = PRICE_VERIFIED.isoformat()


class ImageEntry(Contract):
    id: str
    milestone: str
    created_at: str
    updated_at: str
    estimate: ImageCostEstimate
    status: Literal['pending', 'success', 'provider_error']
    accounted_usd: Decimal = Field(ge=0)
    upper_bound_exceeded: bool = False
    pricing_uncertain: bool = False


class Ledger(Contract):
    version: Literal[1]
    entries: list[Entry | ImageEntry]

    @model_validator(mode="after")
    def intact(self):
        if len({e.id for e in self.entries}) != len(self.entries):
            raise ValueError("Duplicate ledger records")
        for e in self.entries:
            estimate = e.estimate
            if isinstance(e, ImageEntry):
                if (estimate.usd_per_image != Decimal('0.01') or estimate.upper_usd != estimate.usd_per_image
                        or e.accounted_usd < estimate.upper_usd):
                    raise ValueError('Invalid image cost record')
                continue
            # Historical entries retain their original rate card across future
            # price changes. Never recalculate old spending at today's rates.
            if estimate.upper_usd != estimate.cost(estimate.input_tokens_upper, estimate.max_output_tokens):
                raise ValueError("Invalid cost record")
            known = e.usage is not None and not e.pricing_uncertain
            expected = e.usage_estimated_usd if known else estimate.upper_usd
            if known and e.usage_estimated_usd != estimate.cost(e.usage.input_tokens, e.usage.output_tokens):
                raise ValueError("Invalid usage cost")
            if expected is None or e.accounted_usd < expected or (e.status == "pending" and e.accounted_usd < estimate.upper_usd):
                raise ValueError("Under-accounted request")
        return self


def estimate_request(body: dict, *, today: date | None = None) -> CostEstimate:
    today = today or datetime.now(timezone.utc).date()
    if not PRICE_VERIFIED <= today <= PRICE_EXPIRES:
        raise CulinaryError("pricing_expired", "Re-verify official Standard pricing before live use; existing ledger must be retained.")
    allowed = {"model", "messages", "response_format", "max_completion_tokens", "reasoning_effort", "n", "stream", "store"}
    if (set(body) != allowed or body.get("model") != MODEL or body.get("n") != 1
            or body.get("stream") is not False or body.get("store") is not False):
        raise CulinaryError("unpriced_request", "Only text-only Standard Muse Spark without tools has a verified cost estimate.")
    messages = body.get("messages")
    if (not isinstance(messages, list) or len(messages) != 2
            or any(set(m) != {"role", "content"} or not isinstance(m["content"], str) for m in messages)):
        raise CulinaryError("unbounded_input", "Cost estimation requires two bounded plain-text messages.")
    limit = body.get("max_completion_tokens")
    if type(limit) is not int or not 1 <= limit <= MAX_OUTPUT_TOKENS:
        raise CulinaryError("unbounded_output", "A modest, explicit output-token cap is required.")
    size = len(json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    if size > MAX_REQUEST_BYTES:
        raise CulinaryError("context_limit", "The request exceeds the small text-only smoke-test context limit.")
    # Deliberately NOT a chars/4 average. Includes schema, JSON escaping and
    # framing allowance, at twice the UTF-8 bytes plus 2048. Not an exact Meta
    # tokenizer; no unseen tools/media may use this estimator. See docs.
    upper = 2 * size + 2048
    return CostEstimate(model=MODEL, input_tokens_upper=upper, max_output_tokens=limit,
        request_bytes=size, upper_usd=token_cost(upper, limit), input_per_million=INPUT_PER_MILLION,
        output_per_million=OUTPUT_PER_MILLION, pricing_verified=PRICE_VERIFIED.isoformat(), pricing_source=PRICING_SOURCE)


class UsageBudget:
    def __init__(self, path: Path = LEDGER_PATH, extra_limits: dict[str, tuple[Decimal, int]] | None = None):
        self.path = Path(path)
        self.lock_path = self.path.with_suffix(".lock")
        self.extra_limits = dict(extra_limits or {})
        for name, policy in (extra_limits or {}).items():
            if name in MILESTONES or not name or policy[0] <= 0 or policy[0] > CUMULATIVE_LIMIT or not 0 < policy[1] <= 100:
                raise CulinaryError("invalid_budget", "The additional spending policy is invalid.")

    @property
    def limits(self):
        # Preserve the existing milestone registration behavior, including
        # explicit policies installed after a budget object was constructed.
        return {**MILESTONES, **self.extra_limits}

    @contextmanager
    def _locked(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.path.is_symlink() or self.lock_path.is_symlink():
                raise OSError("Symlink ledger")
            # Never initialize again if a prior ledger disappeared.
            existed = self.lock_path.exists()
            fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a+") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    if self.path.exists():
                        ledger = Ledger.model_validate_json(self.path.read_text())
                    elif existed:
                        raise CulinaryError("ledger_missing", "The cumulative ledger is missing. Restore it; do not reset spending history.")
                    else:
                        ledger = Ledger(version=1, entries=[])
                        self._write(ledger)
                    yield ledger
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
        except (OSError, ValueError, ValidationError) as exc:
            raise CulinaryError("ledger_unavailable", "Cannot verify the local usage ledger; live requests are blocked.") from None

    def _write(self, ledger: Ledger):
        Ledger.model_validate(ledger.model_dump())
        fd, temporary = tempfile.mkstemp(prefix="usage-", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(ledger.model_dump_json(indent=2))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def summary(self, milestone: str = "4D.1") -> dict:
        if not self.path.exists() and not self.lock_path.exists():
            ledger = Ledger(version=1, entries=[])
        else:
            with self._locked() as data:
                ledger = data.model_copy(deep=True)
        total = sum((e.accounted_usd for e in ledger.entries), Decimal(0))
        if milestone not in self.limits:
            raise CulinaryError("unknown_milestone", "No spending policy is registered for this milestone.")
        spent = sum((e.accounted_usd for e in ledger.entries if e.milestone == milestone), Decimal(0))
        return {"accounted_usd": str(total), "remaining_usd": str(max(Decimal(0), CUMULATIVE_LIMIT - total)),
            "milestone_accounted_usd": str(spent), "milestone_remaining_usd": str(max(Decimal(0), self.limits[milestone][0] - spent)),
            "attempts": sum(e.milestone == milestone for e in ledger.entries), "billing_verified": False}

    def reserve(self, estimate: CostEstimate, milestone: str = "4D.1") -> str:
        if milestone not in self.limits:
            raise CulinaryError("unknown_milestone", "No spending policy is registered for this milestone.")
        if self.limits[milestone][1] == 0:
            raise CulinaryError("live_disabled", "No live attempts are authorized for this milestone. No ledger reservation was made.")
        if (not PRICE_VERIFIED <= datetime.now(timezone.utc).date() <= PRICE_EXPIRES
                or estimate.pricing_verified != PRICE_VERIFIED.isoformat()
                or estimate.input_per_million != INPUT_PER_MILLION or estimate.output_per_million != OUTPUT_PER_MILLION
                or estimate.input_tokens_upper != 2 * estimate.request_bytes + 2048
                or estimate.upper_usd != token_cost(estimate.input_tokens_upper, estimate.max_output_tokens)):
            raise CulinaryError("invalid_estimate", "A current, verified cost estimate is required before reservation.")
        with self._locked() as ledger:
            limit, attempts = self.limits[milestone]
            local = [e for e in ledger.entries if e.milestone == milestone]
            if any(e.upper_bound_exceeded or e.pricing_uncertain for e in ledger.entries):
                raise CulinaryError("estimate_breached", "Reported usage exceeded the estimate or its model pricing is uncertain. Review the Meta dashboard before any further calls.")
            if len(local) >= attempts:
                raise CulinaryError("attempt_limit", f"This milestone permits at most {attempts} live requests in total, including failed or interrupted attempts.")
            if (sum((e.accounted_usd for e in ledger.entries), Decimal(0)) + estimate.upper_usd > CUMULATIVE_LIMIT
                    or sum((e.accounted_usd for e in local), Decimal(0)) + estimate.upper_usd > limit):
                raise CulinaryError("budget_exceeded", "The conservative reservation would exceed the local development budget.")
            entry = Entry(id=str(uuid4()), milestone=milestone, created_at=timestamp(), updated_at=timestamp(),
                estimate=estimate, status="pending", accounted_usd=estimate.upper_usd)
            ledger.entries.append(entry)
            self._write(ledger)
            return entry.id

    def reserve_image(self, milestone: str) -> str:
        if milestone not in self.limits or self.limits[milestone][1] == 0:
            raise CulinaryError('live_disabled', 'No image spending policy is registered or authorized.')
        if not PRICE_VERIFIED <= datetime.now(timezone.utc).date() <= PRICE_EXPIRES:
            raise CulinaryError('invalid_estimate', 'Image pricing requires a current review.')
        estimate = ImageCostEstimate()
        with self._locked() as ledger:
            local = [e for e in ledger.entries if e.milestone == milestone]
            cap, attempts = self.limits[milestone]
            if any(e.upper_bound_exceeded or e.pricing_uncertain for e in ledger.entries):
                raise CulinaryError('estimate_breached', 'Review the Meta dashboard before further spending.')
            if len(local) >= attempts:
                raise CulinaryError('attempt_limit', 'The approved image attempt limit is exhausted.')
            if (sum((e.accounted_usd for e in ledger.entries), Decimal(0)) + estimate.upper_usd > CUMULATIVE_LIMIT
                    or sum((e.accounted_usd for e in local), Decimal(0)) + estimate.upper_usd > cap):
                raise CulinaryError('budget_exceeded', 'The image reservation exceeds the approved local budget.')
            entry = ImageEntry(id=str(uuid4()), milestone=milestone, created_at=timestamp(), updated_at=timestamp(),
                estimate=estimate, status='pending', accounted_usd=estimate.upper_usd)
            ledger.entries.append(entry)
            self._write(ledger)
            return entry.id

    def finish_image(self, request_id: str, *, success: bool):
        with self._locked() as ledger:
            entry = next((e for e in ledger.entries if e.id == request_id), None)
            if not isinstance(entry, ImageEntry) or entry.status != 'pending':
                raise CulinaryError('ledger_state', 'The image reservation cannot be reconciled.')
            entry.status = 'success' if success else 'provider_error'
            entry.updated_at = timestamp()
            # Conservative accounting retains the full image price even when
            # provider billing for a failed request is unknown.
            self._write(ledger)

    def finish(self, request_id: str, status: Literal["success", "invalid_output", "provider_error"], usage: TokenUsage | None,
               *, pricing_verified: bool = True, reported_model: str | None = None):
        with self._locked() as ledger:
            entry = next((e for e in ledger.entries if e.id == request_id), None)
            if not isinstance(entry, Entry) or entry.status != "pending":
                raise CulinaryError("ledger_state", "The usage reservation cannot be reconciled.")
            entry.updated_at = timestamp()
            entry.usage = usage
            entry.pricing_uncertain = not pricing_verified
            entry.reported_model = reported_model
            entry.status = "unknown_usage" if usage is None and status == "success" else status
            if usage is not None and pricing_verified:
                entry.usage_estimated_usd = entry.estimate.cost(usage.input_tokens, usage.output_tokens)
                entry.accounted_usd = entry.usage_estimated_usd
                entry.upper_bound_exceeded = (usage.input_tokens > entry.estimate.input_tokens_upper
                    or usage.output_tokens > entry.estimate.max_output_tokens or entry.accounted_usd > entry.estimate.upper_usd)
            self._write(ledger)
