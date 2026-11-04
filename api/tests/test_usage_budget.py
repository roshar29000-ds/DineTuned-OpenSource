from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
import json

import pytest
from app.culinary.errors import CulinaryError
from app.culinary.meta import MetaConfig, request_body
from app.culinary.smoke_fixture import smoke_context
from app.usage_budget import (UsageBudget, TokenUsage, estimate_request, token_cost, MAX_OUTPUT_TOKENS,
    Entry, Ledger, timestamp, MILESTONES)


def estimate():
    return estimate_request(request_body(smoke_context(), MetaConfig()))


def historical(budget, *, total="9.99", milestone="4D.previous"):
    # Retain previous/future milestone spending rather than resetting the file.
    quote = estimate()
    row = Entry(id="prior", milestone=milestone, created_at=timestamp(), updated_at=timestamp(),
        estimate=quote, accounted_usd=Decimal(total), status="unknown_usage")
    budget.path.parent.mkdir(parents=True, exist_ok=True)
    budget.path.write_text(Ledger(version=1, entries=[row]).model_dump_json())


def record_first_attempt(budget):
    """Reproduce the original usage in an isolated test ledger, never the real one."""
    quote = estimate_request(request_body(smoke_context(), MetaConfig(max_output_tokens=1536)))
    identifier = budget.reserve(quote)
    budget.finish(identifier, "invalid_output", TokenUsage(input_tokens=4992, output_tokens=1536,
        total_tokens=6528, reasoning_tokens=1534), reported_model="muse-spark-1.3")
    assert budget.summary()["accounted_usd"] == "0.012768"
    return json.loads(budget.path.read_text())["entries"][0]


def test_estimate_is_conservative_includes_schema_and_reasoning_cap():
    body = request_body(smoke_context(), MetaConfig())
    quote = estimate_request(body)
    assert quote.input_tokens_upper == quote.request_bytes * 2 + 2048
    assert quote.max_output_tokens == MAX_OUTPUT_TOKENS
    assert quote.upper_usd == token_cost(quote.input_tokens_upper, MAX_OUTPUT_TOKENS)
    assert 0 < quote.upper_usd < Decimal("0.10")
    body["messages"][1]["content"] += "界" * 10
    assert estimate_request(body).upper_usd > quote.upper_usd
    assert token_cost(1_000_000, 1_000_000) == Decimal("5.50")


def test_new_output_headroom_is_fully_reserved_without_changing_spending_policies():
    new = estimate()
    old = estimate_request(request_body(smoke_context(), MetaConfig(max_output_tokens=1536)))
    assert new.max_output_tokens == 3072
    assert new.upper_usd - old.upper_usd == Decimal("0.006528")
    assert MILESTONES["4D.1"] == (Decimal("1"), 2)
    from app.usage_budget import CUMULATIVE_LIMIT
    assert CUMULATIVE_LIMIT == Decimal("10")


@pytest.mark.parametrize("change", [{"model": "muse-spark-1.3-contributor"}, {"model": "muse-wonder"},
    {"tools": []}, {"max_completion_tokens": None}, {"max_completion_tokens": 9999},
    {"max_completion_tokens": True}, {"messages": [{"role": "user", "content": [{"type": "image_url"}]}]}])
def test_unpriceable_inputs_fail_closed(change):
    body = request_body(smoke_context(), MetaConfig())
    body.update(change)
    with pytest.raises(CulinaryError): estimate_request(body)


def test_oversized_or_expired_context_fails_closed():
    body = request_body(smoke_context(), MetaConfig())
    with pytest.raises(CulinaryError, match="Re-verify"): estimate_request(body, today=date(2026, 11, 6))
    body["messages"][1]["content"] = "x" * 24001
    with pytest.raises(CulinaryError, match="context limit"): estimate_request(body)


def test_empty_summary_does_not_initialize_or_reset_ledger(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    assert budget.summary()["remaining_usd"] == "10"
    assert not budget.path.exists() and not budget.lock_path.exists()


def test_second_attempt_preserves_first_cost_and_third_attempt_is_blocked(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    first = record_first_attempt(budget)
    quote = estimate()
    identifier = budget.reserve(quote)
    assert Decimal(budget.summary()["accounted_usd"]) == Decimal("0.012768") + quote.upper_usd
    usage = TokenUsage(input_tokens=1000, output_tokens=300, total_tokens=1300, cached_input_tokens=500, reasoning_tokens=100)
    budget.finish(identifier, "success", usage)
    assert Decimal(budget.summary()["accounted_usd"]) == Decimal("0.012768") + Decimal("0.002525")
    assert budget.summary()["remaining_usd"] == "9.984707"
    # Cache discount never assumed; reasoning already included in completion tokens.
    assert budget.summary()["attempts"] == 2
    assert json.loads(budget.path.read_text())["entries"][0] == first
    assert budget.path.stat().st_mode & 0o777 == 0o600
    before = budget.path.read_bytes()
    with pytest.raises(CulinaryError, match="at most 2"):
        UsageBudget(budget.path).reserve(quote)
    assert budget.path.read_bytes() == before


@pytest.mark.parametrize("status", ["success", "provider_error", "invalid_output"])
def test_unknown_usage_and_errors_keep_full_reservation(tmp_path, status):
    budget = UsageBudget(tmp_path / "usage.json")
    record_first_attempt(budget)
    identifier = budget.reserve(estimate())
    before = budget.summary()
    budget.finish(identifier, status, None)
    assert budget.summary() == before
    with pytest.raises(CulinaryError): budget.reserve(estimate())


def test_pending_crash_survives_reopening_and_missing_or_corrupt_ledger_blocks(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    record_first_attempt(budget)
    budget.reserve(estimate())
    with pytest.raises(CulinaryError): UsageBudget(budget.path).reserve(estimate())
    budget.path.unlink()
    with pytest.raises(CulinaryError, match="Restore"): budget.reserve(estimate())
    budget.path.write_text('{"entries": "corrupt"}')
    with pytest.raises(CulinaryError, match="ledger"): budget.reserve(estimate())


def test_cumulative_ten_dollars_includes_other_milestones(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    historical(budget)
    assert budget.summary()["remaining_usd"] == "0.01"
    with pytest.raises(CulinaryError, match="budget"): budget.reserve(estimate())
    assert budget.summary()["attempts"] == 0


def test_milestone_one_dollar_still_blocks_the_second_attempt(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    historical(budget, total="0.99", milestone="4D.1")
    with pytest.raises(CulinaryError, match="budget"): budget.reserve(estimate())
    assert budget.summary()["remaining_usd"] == "9.01"


def test_budget_exact_boundary_is_allowed_and_next_cent_is_not(tmp_path):
    quote = estimate()
    budget = UsageBudget(tmp_path / "exact.json")
    historical(budget, total=str(Decimal("10") - quote.upper_usd))
    budget.reserve(quote)
    assert budget.summary()["remaining_usd"] == "0"
    other = UsageBudget(tmp_path / "over.json")
    historical(other, total=str(Decimal("10") - quote.upper_usd + Decimal("0.000001")))
    with pytest.raises(CulinaryError, match="budget"): other.reserve(quote)


def test_two_concurrent_reservations_cannot_bypass_limit(tmp_path):
    path = tmp_path / "usage.json"
    first = record_first_attempt(UsageBudget(path))
    quote = estimate()
    def reserve():
        try:
            return UsageBudget(path).reserve(quote)
        except CulinaryError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert len([r for r in results if r]) == 1
    assert UsageBudget(path).summary()["attempts"] == 2
    assert json.loads(path.read_text())["entries"][0] == first


def test_unexpected_usage_above_bound_blocks_future_milestones(tmp_path, monkeypatch):
    budget = UsageBudget(tmp_path / "usage.json")
    quote = estimate()
    identifier = budget.reserve(quote)
    usage = TokenUsage(input_tokens=quote.input_tokens_upper + 1, output_tokens=1, total_tokens=quote.input_tokens_upper + 2)
    budget.finish(identifier, "success", usage)
    monkeypatch.setitem(MILESTONES, "4D.2", (Decimal("1"), 1))
    with pytest.raises(CulinaryError, match="exceeded the estimate"): budget.reserve(quote, "4D.2")


def test_invalid_ledger_cannot_hide_spending(tmp_path):
    budget = UsageBudget(tmp_path / "usage.json")
    budget.reserve(estimate())
    raw = json.loads(budget.path.read_text())
    raw["entries"][0]["accounted_usd"] = "-0.01"
    budget.path.write_text(json.dumps(raw))
    with pytest.raises(CulinaryError): budget.summary()


@pytest.mark.parametrize("partial", ["{}", '{"version":1}', '{"entries":[]}'])
def test_partial_ledger_is_not_silently_initialized_to_zero(tmp_path, partial):
    budget = UsageBudget(tmp_path / "usage.json")
    budget.path.write_text(partial)
    with pytest.raises(CulinaryError, match="ledger"): budget.reserve(estimate())


def test_stored_historical_rate_card_survives_a_future_pricing_update(tmp_path, monkeypatch):
    import app.usage_budget as module
    budget = UsageBudget(tmp_path / "usage.json")
    identifier = budget.reserve(estimate())
    monkeypatch.setattr(module, "INPUT_PER_MILLION", Decimal("2"))
    monkeypatch.setattr(module, "OUTPUT_PER_MILLION", Decimal("8"))
    budget.finish(identifier, "success", TokenUsage(input_tokens=1000, output_tokens=300, total_tokens=1300))
    assert budget.summary()["accounted_usd"] == "0.002525"
