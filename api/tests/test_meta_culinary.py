import json
from pathlib import Path
import subprocess
import sys

import httpx
from openai import OpenAI
import pytest
from pydantic import ValidationError

from app.culinary.context import build_context
from app.culinary.contracts import CulinaryProposal, FactClaim
from app.culinary.demo import DemoCulinaryProvider
from app.culinary.errors import CulinaryError
from app.culinary.meta import BASE_URL, LiveConsent, MetaConfig, MetaCulinaryProvider, request_body
from app.culinary.smoke_fixture import smoke_context, mock_transport
from app.culinary.validation import validate_output
from app.schemas import AllergyProfile, DiningConstraints, RecommendationRequest, TasteAxes, TasteProfile, Price
from app.services.catalog import get_menu
from app.usage_budget import MODEL, UsageBudget


def original_demo_menu(restaurant):
    """Keep the bounded developer smoke tests on the original fixture subset."""
    catalog = json.loads((Path(__file__).resolve().parents[1] / 'app/data/catalog.json').read_text())
    original_ids = {item['id'] for row in catalog if row['id'] == restaurant for item in row['menu']}
    menu = get_menu(restaurant).model_copy(deep=True)
    for category in menu.categories:
        category.items = [item for item in category.items if item.id in original_ids]
    menu.categories = [category for category in menu.categories if category.items]
    menu.total_items = len(original_ids)
    return menu


def response(context):
    return {"id": "test-response", "object": "chat.completion", "created": 0, "model": MODEL,
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant",
            "content": DemoCulinaryProvider().propose(context).proposal.model_dump_json()}}],
        "usage": {"prompt_tokens": 1000, "completion_tokens": 300, "total_tokens": 1300,
            "prompt_tokens_details": {"cached_tokens": 100}, "completion_tokens_details": {"reasoning_tokens": 40}}}


def simulated_live(monkeypatch, tmp_path, callback):
    """Exercise the live code path with in-memory HTTP only and an isolated ledger."""
    monkeypatch.setenv("MODEL_API_KEY", "synthetic-test-key")
    provider = MetaCulinaryProvider(consent=LiveConsent(True, True), budget=UsageBudget(tmp_path / "usage.json"))
    calls = []
    def handle(request):
        calls.append(request)
        return callback(request)
    def client(key):
        return OpenAI(api_key=key, base_url=provider.config.base_url, max_retries=0, timeout=30,
            http_client=httpx.Client(transport=httpx.MockTransport(handle), follow_redirects=False, trust_env=False))
    monkeypatch.setattr(provider, "_client", client)
    return provider, calls


def test_successful_structured_response_validates_identity_prices_and_evidence():
    context = smoke_context()
    provider = MetaCulinaryProvider(mock_transport=mock_transport(context))
    output = provider.propose(context)
    result = validate_output(output, context)
    assert output.mode == "mock" and output.model == MODEL
    assert len(result.recommendations) == 3 and not result.rejected
    assert result.restaurant_id == context.menu.restaurant.id and result.menu_version == context.menu.version
    assert provider.trace.ledger_request_id is None
    assert all(p.evidence and p.taste_bridge.shared for p in result.recommendations)
    assert result.recommendations[-1].budget.overage_minor == 100


def test_official_sdk_params_and_two_attempt_cap_without_automatic_retries(monkeypatch, tmp_path):
    context = smoke_context()
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=response(context)))
    result = validate_output(provider.propose(context), context)
    assert result.mode == "meta"  # Simulated live code path; HTTP is in-memory.
    assert len(calls) == 1
    sent = json.loads(calls[0].content)
    assert str(calls[0].url) == BASE_URL + "/chat/completions"
    assert sent["model"] == MODEL and sent["reasoning_effort"] == "minimal"
    assert sent["max_completion_tokens"] == 3072
    assert sent["stream"] is False and sent["store"] is False
    assert sent["n"] == 1 and "tools" not in sent
    assert sent["response_format"]["json_schema"]["strict"] is True
    assert provider.trace.usage.reasoning_tokens == 40
    assert provider.budget.summary()["accounted_usd"] == "0.002525"
    # A second deliberate invocation is permitted; there is no automatic retry.
    first = json.loads(provider.budget.path.read_text())["entries"][0]
    provider.propose(context)
    assert len(calls) == 2 and provider.budget.summary()["attempts"] == 2
    assert json.loads(provider.budget.path.read_text())["entries"][0] == first
    before = provider.budget.path.read_bytes()
    with pytest.raises(CulinaryError, match="at most 2"): provider.propose(context)
    assert len(calls) == 2 and provider.budget.path.read_bytes() == before


def test_strict_json_schema_requires_every_property_and_disallows_extra_fields():
    schema = CulinaryProposal.model_json_schema()
    def inspect(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for value in node.values(): inspect(value)
        elif isinstance(node, list):
            for value in node: inspect(value)
    inspect(schema)


@pytest.mark.parametrize("consent", [LiveConsent(), LiveConsent(True, False), LiveConsent(False, True)])
def test_key_presence_never_authorizes_live_calls(consent, monkeypatch, tmp_path):
    monkeypatch.setenv("MODEL_API_KEY", "synthetic-key")
    budget = UsageBudget(tmp_path / "usage.json")
    provider = MetaCulinaryProvider(consent=consent, budget=budget)
    with pytest.raises(CulinaryError, match="both --live"): provider.propose(smoke_context())
    assert not budget.path.exists()


@pytest.mark.parametrize("key", [None, "", "   ", "invalid\nkey", "invalid key"])
def test_missing_or_invalid_key_has_no_network_or_reservation(key, monkeypatch, tmp_path):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    if key is not None: monkeypatch.setenv("MODEL_API_KEY", key)
    budget = UsageBudget(tmp_path / "usage.json")
    provider = MetaCulinaryProvider(consent=LiveConsent(True, True), budget=budget)
    with pytest.raises(CulinaryError, match="Set a valid MODEL_API_KEY"): provider.propose(smoke_context())
    assert not budget.path.exists()


@pytest.mark.parametrize("config", [MetaConfig(model="muse-spark-1.3-contributor"), MetaConfig(model="muse-wonder"),
    MetaConfig(base_url="https://untrusted.example/v1"), MetaConfig(base_url="http://api.meta.ai/v1"),
    MetaConfig(max_output_tokens=99999), MetaConfig(timeout_seconds=120), MetaConfig(reasoning_effort="high"),
    MetaConfig(reasoning_effort="none"), MetaConfig(reasoning_effort="")])
def test_unknown_model_endpoint_or_limits_fail_before_request(config):
    with pytest.raises(CulinaryError): MetaCulinaryProvider(config, mock_transport=httpx.MockTransport(lambda _: None)).propose(smoke_context())


def test_configuration_is_backend_only_and_legacy_bypass_disabled(monkeypatch):
    monkeypatch.setenv("META_MODEL", "unpriced-model")
    monkeypatch.setenv("META_MODEL_BASE_URL", "https://wrong.example")
    cfg = MetaConfig.from_environment()
    assert cfg.model == "unpriced-model" and cfg.base_url == "https://wrong.example"
    from app.meta_client import model_ask
    with pytest.raises(CulinaryError, match="disabled"): model_ask("irrelevant")
    from app.main import app
    # OpenAPI flattens included routers on both old and new FastAPI versions.
    assert not any("meta" in path or "culinary" in path for path in app.openapi()["paths"])


@pytest.mark.parametrize("status,code", [(401, "authentication_failed"), (429, "rate_limited"), (500, "provider_error")])
def test_errors_are_sanitized_not_retried_and_keep_reservations(monkeypatch, tmp_path, status, code):
    private = "PRIVATE PROFILE AND KEY MUST NOT LEAK"
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(status, json={"error": {"message": private}}))
    with pytest.raises(CulinaryError) as error: provider.propose(smoke_context())
    assert error.value.code == code and private not in str(error.value)
    assert len(calls) == 1 and provider.trace.usage is None
    assert provider.budget.summary()["accounted_usd"] == str(provider.trace.estimate.upper_usd)
    assert private not in provider.budget.path.read_text()


def test_timeout_is_not_retried(monkeypatch, tmp_path):
    def timeout(request): raise httpx.ReadTimeout("private body", request=request)
    provider, calls = simulated_live(monkeypatch, tmp_path, timeout)
    with pytest.raises(CulinaryError, match="timed out"): provider.propose(smoke_context())
    assert len(calls) == 1 and provider.budget.summary()["attempts"] == 1


@pytest.mark.parametrize("mutation", ["invalid_json", "extra_claim", "wrong_model", "truncated", "tool", "missing_content",
    "no_choices", "multiple_choices", "refusal", "content_filter"])
def test_malformed_responses_fail_without_retry_but_usage_is_accounted(monkeypatch, tmp_path, mutation):
    context = smoke_context()
    body = response(context)
    message = body["choices"][0]["message"]
    if mutation == "invalid_json": message["content"] = "not json"
    if mutation == "extra_claim":
        raw = json.loads(message["content"])
        raw["candidates"][0]["ingredients"] = ["invented truffle"]
        message["content"] = json.dumps(raw)
    if mutation == "wrong_model": body["model"] = "muse-wonder"
    if mutation == "truncated": body["choices"][0]["finish_reason"] = "length"
    if mutation == "tool": body["choices"][0]["finish_reason"] = "tool_calls"
    if mutation == "missing_content": message["content"] = None
    if mutation == "no_choices": body["choices"] = []
    if mutation == "multiple_choices": body["choices"] *= 2
    if mutation == "refusal": message["refusal"] = "Cannot comply"
    if mutation == "content_filter": body["choices"][0]["finish_reason"] = "content_filter"
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=body))
    with pytest.raises(CulinaryError): provider.propose(context)
    assert len(calls) == 1
    assert provider.trace.status == "invalid_output"
    assert provider.budget.summary()["accounted_usd"] == (str(provider.trace.estimate.upper_usd) if mutation == "wrong_model" else "0.002525")


@pytest.mark.parametrize("content", [None, "", '{"restaurant_id":', "complete_json"])
@pytest.mark.parametrize("known_usage", [True, False])
def test_reasoning_exhaustion_rejects_even_parseable_truncation_and_never_retries(monkeypatch, tmp_path, content, known_usage):
    context = smoke_context()
    body = response(context)
    body["choices"][0]["finish_reason"] = "length"
    if content != "complete_json":
        body["choices"][0]["message"]["content"] = content
    # Recorded failure shape, replayed OFFLINE against an isolated ledger.
    body["usage"] = {"prompt_tokens": 4992, "completion_tokens": 1536, "total_tokens": 6528,
        "completion_tokens_details": {"reasoning_tokens": 1534}} if known_usage else None
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=body))
    provider.config = MetaConfig(max_output_tokens=1536)
    with pytest.raises(CulinaryError) as error:
        provider.propose(context)
    assert error.value.code == "output_truncated"
    assert "no retry" in str(error.value)
    assert ("1534 of 1536" in str(error.value)) == known_usage
    assert len(calls) == 1 and provider.trace.finish_reason == "length"
    assert provider.trace.status == "invalid_output"
    assert provider.budget.summary()["accounted_usd"] == ("0.012768" if known_usage else str(provider.trace.estimate.upper_usd))
    first = json.loads(provider.budget.path.read_text())["entries"][0]
    # A deliberate second attempt also consumes its slot on failure. Changing
    # token settings never rewrites old spending or grants a third attempt.
    provider.config = MetaConfig()
    with pytest.raises(CulinaryError) as second_error:
        provider.propose(context)
    assert second_error.value.code == "output_truncated" and len(calls) == 2
    assert json.loads(provider.budget.path.read_text())["entries"][0] == first
    before = provider.budget.path.read_bytes()
    with pytest.raises(CulinaryError, match="at most 2"):
        provider.propose(context)
    assert len(calls) == 2 and provider.budget.path.read_bytes() == before


def test_complete_json_after_reasoning_is_valid_with_new_bounded_headroom(monkeypatch, tmp_path):
    context = smoke_context()
    body = response(context)
    body["usage"] = {"prompt_tokens": 4992, "completion_tokens": 2434, "total_tokens": 7426,
        "completion_tokens_details": {"reasoning_tokens": 1534}}
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=body))
    result = validate_output(provider.propose(context), context)
    assert len(result.recommendations) == 3 and provider.trace.finish_reason == "stop"
    sent = json.loads(calls[0].content)
    assert 1536 < body["usage"]["completion_tokens"] <= sent["max_completion_tokens"] == 3072
    assert sent["reasoning_effort"] == "minimal" and len(calls) == 1


def test_truncation_without_reasoning_details_does_not_claim_zero_reasoning(monkeypatch, tmp_path):
    context = smoke_context()
    body = response(context)
    body["choices"][0]["finish_reason"] = "length"
    body["usage"] = {"prompt_tokens": 4992, "completion_tokens": 3072, "total_tokens": 8064}
    provider, calls = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=body))
    with pytest.raises(CulinaryError, match="3072 completion tokens; reasoning breakdown unavailable") as error:
        provider.propose(context)
    assert error.value.code == "output_truncated" and len(calls) == 1
    assert "Reasoning used 0" not in str(error.value)


@pytest.mark.parametrize("usage", [None, {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 99}])
def test_unknown_or_inconsistent_usage_keeps_entire_reservation(monkeypatch, tmp_path, usage):
    context = smoke_context()
    body = response(context)
    body["usage"] = usage
    provider, _ = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=body))
    provider.propose(context)
    assert provider.trace.usage is None
    assert provider.budget.summary()["accounted_usd"] == str(provider.trace.estimate.upper_usd)


@pytest.mark.parametrize("mutation,reason", [("unknown", "unknown_item"), ("duplicate", "duplicate_item"),
    ("ingredient", "unsupported_evidence"), ("preparation", "unsupported_evidence"),
    ("anchor", "unsupported_evidence"), ("tentative", "tentative_fit")])
def test_independent_validation_rejects_fabricated_or_weak_candidates(mutation, reason):
    context = smoke_context()
    output = DemoCulinaryProvider().propose(context)
    candidate = output.proposal.candidates[0]
    output.proposal.candidates = [candidate]
    if mutation == "unknown": candidate.item_id = "made-up-dish"
    if mutation == "duplicate": output.proposal.candidates.append(candidate.model_copy(deep=True))
    if mutation in {"ingredient", "preparation"}:
        candidate.claims[0].attribute = "ingredient" if mutation == "ingredient" else "cooking"
        candidate.claims[0].value = "truffle" if mutation == "ingredient" else "smoked"
    if mutation == "anchor": candidate.anchor_id = "invented-favorite"
    if mutation == "tentative": candidate.fit = "tentative"
    result = validate_output(output, context)
    assert not result.recommendations and not result.worth_the_stretch
    assert all(r["reason"] == reason for r in result.rejected)


def test_boolean_is_not_a_numeric_factual_claim():
    with pytest.raises(ValidationError): FactClaim(fact_id="fact-1", attribute="spice", value=True)


def test_stale_input_or_model_identity_is_rejected():
    context = smoke_context()
    req = context.request.model_copy(update={"menu_version": "old-version"})
    with pytest.raises(CulinaryError): build_context(req, context.menu)
    output = DemoCulinaryProvider().propose(context)
    output.proposal.restaurant_id = "other-restaurant"
    with pytest.raises(CulinaryError): validate_output(output, context)


@pytest.mark.parametrize("change", ["allergy", "diet", "unavailable", "unknown_price"])
def test_revalidation_rejects_safety_or_menu_changes_independently(change):
    context = smoke_context()
    output = DemoCulinaryProvider().propose(context)
    if change == "allergy": context.request.profile.allergies = AllergyProfile(allergens=["peanut"])
    if change == "diet": context.request.constraints = DiningConstraints(dietary_restrictions=["vegan", "gluten_free"])
    if change in {"unavailable", "unknown_price"}:
        for cat in context.menu.categories:
            for item in cat.items:
                if change == "unavailable": item.available = False
                else: item.price = Price(amount_minor=None, status="unknown")
    assert not validate_output(output, context).recommendations


def test_combined_diets_and_allergy_unknowns_filter_before_sending():
    menu = original_demo_menu("saigon-table")
    req = RecommendationRequest(restaurant_id=menu.restaurant.id, menu_version=menu.version,
        constraints=DiningConstraints(dietary_restrictions=["vegetarian", "dairy_free"]),
        profile=TasteProfile(axes=TasteAxes(spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8)))
    assert list(build_context(req, menu).bridges) == ["tofu-bun"]
    req.profile.allergies = AllergyProfile(allergens=["peanut"])
    context = build_context(req, menu)
    assert not context.wire()["items"]
    with pytest.raises(CulinaryError, match="No eligible"): MetaCulinaryProvider(mock_transport=mock_transport(context)).propose(context)


def test_budget_tiers_use_cents_and_hide_above_target_without_changing_ranker():
    context = smoke_context()
    output = DemoCulinaryProvider().propose(context)
    output.proposal.candidates.reverse()  # Above-target candidate deliberately first.
    result = validate_output(output, context)
    assert [p.budget.overage_minor for p in result.recommendations] == [0, 0, 100]
    context.request.constraints.max_price_minor = 1899
    result = validate_output(output, context)
    assert result.recommendations[0].dish.id == "mushroom-taco"
    assert {p.budget.overage_minor for p in result.recommendations} == {0, 1, 201}
    context.request.options.include_over_budget = False
    result = validate_output(output, context)
    assert [p.dish.id for p in result.recommendations] == ["mushroom-taco"]
    assert not result.worth_the_stretch


def test_unknown_taste_cannot_borrow_other_user_evidence_and_refinements_are_forwarded():
    context = smoke_context()
    output = DemoCulinaryProvider().propose(context)
    wire = context.wire()
    assert "favorites" in wire["profile"] and wire["confidence_basis"]["sweetness"] == "unknown"
    context.request.refinements.preferences = ["lighter"]
    context.request.refinements.avoid_dish_ids = [output.proposal.candidates[0].item_id]
    changed = build_context(context.request, context.menu)
    assert changed.wire()["refinements"]["preferences"] == ["lighter"]
    assert output.proposal.candidates[0].item_id not in changed.bridges
    context.request.profile = TasteProfile()
    context.request.taste_evidence = type(context.request.taste_evidence)()
    assert not validate_output(output, context).recommendations


def test_two_menus_keep_exact_prices_and_no_duplicates_across_primary_and_stretch():
    for restaurant in ("saigon-table", "casa-sol"):
        menu = original_demo_menu(restaurant)
        request = RecommendationRequest(restaurant_id=menu.restaurant.id, menu_version=menu.version,
            constraints=DiningConstraints(max_price_minor=100),
            profile=TasteProfile(axes=TasteAxes(spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8)))
        context = build_context(request, menu)
        output = DemoCulinaryProvider().propose(context)
        result = validate_output(output, context)
        assert result.recommendations
        assert len(result.recommendations) <= 3 and len(result.worth_the_stretch) <= 2
        all_picks = [*result.recommendations, *result.worth_the_stretch]
        assert len({pick.dish.id for pick in all_picks}) == len(all_picks)
        source = {dish.id: dish for cat in menu.categories for dish in cat.items}
        assert all(pick.dish == source[pick.dish.id] and pick.budget.overage_minor == pick.dish.price.amount_minor - 100 for pick in all_picks)


def test_zero_to_three_primary_results_do_not_get_padded():
    context = smoke_context()
    full = DemoCulinaryProvider().propose(context)
    for count in range(4):
        output = full.model_copy(deep=True)
        output.proposal.candidates = output.proposal.candidates[:count]
        assert len(validate_output(output, context).recommendations) == count


def test_profile_or_menu_data_is_never_stored_in_usage_ledger(monkeypatch, tmp_path):
    context = smoke_context()
    provider, _ = simulated_live(monkeypatch, tmp_path, lambda req: httpx.Response(200, json=response(context)))
    provider.propose(context)
    raw = provider.budget.path.read_text()
    assert context.request.profile.favorites not in raw
    assert "synthetic-test-key" not in raw and "messages" not in raw and "candidates" not in raw


def test_global_test_fixture_rejects_accidental_real_http():
    with pytest.raises(AssertionError, match="Network disabled"):
        httpx.get("https://api.meta.ai/v1")


def test_sdk_debug_logging_cannot_emit_private_profile(monkeypatch, caplog):
    import logging
    context = smoke_context()
    sdk_logger = logging.getLogger("openai._base_client")
    monkeypatch.setattr(sdk_logger, "disabled", False)
    with caplog.at_level(logging.DEBUG, logger="openai._base_client"):
        MetaCulinaryProvider(mock_transport=mock_transport(context)).propose(context)
    assert sdk_logger.disabled
    assert context.request.profile.favorites not in caplog.text


def test_cli_default_is_offline_even_with_environment_key_and_mismatched_flags_fail(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "synthetic-key-must-never-enable-live")
    api = Path(__file__).resolve().parents[1]
    completed = subprocess.run([sys.executable, "scripts/meta_smoke.py"], cwd=api, capture_output=True, text=True, check=True)
    assert "MOCKED/OFFLINE" in completed.stdout and "3 primary picks" in completed.stdout
    assert "No real API call; ledger unchanged" in completed.stdout
    for flag in ("--live", "--confirm-spend"):
        failed = subprocess.run([sys.executable, "scripts/meta_smoke.py", flag], cwd=api, capture_output=True, text=True)
        assert failed.returncode == 1 and "live_disabled" in failed.stderr
