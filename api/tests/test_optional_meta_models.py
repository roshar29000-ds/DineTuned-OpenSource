"""Offline-only Wonder and SAM checks. No provider credentials or website calls."""
from decimal import Decimal
import json
import subprocess
import sys

import httpx
import pytest

from app.culinary.errors import CulinaryError
from app.culinary.meta import LiveConsent, MetaConfig, request_body
from app.main import app
from app.optional_models.sam import SamCache, SamImageSegmenter, parse_image_output
from app.optional_models.wonder import DeepCulinaryReasoner, WonderCache, WonderContext, WonderProposal
from app.real_picks.context import build_context
from app.real_picks.pipeline import recommend
from app.usage_budget import UsageBudget, estimate_request, SAM_IMAGE_USD
from test_real_picks import USER, fixture, mocked_provider, proposal
from app.menu_sources.identity import SelectionProof


def existing_picks():
    request = fixture()
    spark, _ = mocked_provider(proposal(request))
    return request, recommend(request, spark)


def wonder_transport(request, picks, *, mutate=None):
    first, second = (pick.dish for pick in picks.recommendations[:2])
    body = {'restaurant_id': request.extraction.restaurant_id,
        'menu_version': request.extraction.menu.version,
        'comparisons': [{'favored_item_id': first.id, 'alternative_item_id': second.id,
            'preference_id': 'favorites', 'favored_field': 'name', 'favored_quote': first.name,
            'alternative_field': 'name', 'alternative_quote': second.name}]}
    if mutate:
        mutate(body)
    calls = []
    def respond(call):
        calls.append(call)
        return httpx.Response(200, json={'id': 'offline-wonder', 'object': 'chat.completion', 'created': 0,
            'model': 'muse-wonder-1.0', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps(body)}}],
            'usage': {'prompt_tokens': 1000, 'completion_tokens': 200, 'total_tokens': 1200}})
    return httpx.MockTransport(respond), calls


def test_wonder_compares_only_saved_eligible_picks_with_exact_evidence():
    request, picks = existing_picks()
    transport, calls = wonder_transport(request, picks)
    result = DeepCulinaryReasoner(mock_transport=transport).compare(
        USER, request, picks, proof=SelectionProof(b'p' * 32))
    assert result.mode == 'mock' and len(result.comparisons) == 1 and len(calls) == 1
    comparison = result.comparisons[0]
    assert comparison.favored_evidence_id and comparison.alternative_evidence_id
    assert 'allergy safety' in comparison.limitation
    sent = json.loads(calls[0].content)
    assert sent['model'] == 'muse-wonder-1.0' and sent['reasoning_effort'] == 'medium'
    assert sent['stream'] is False and sent['store'] is False and 'tools' not in sent
    wire = json.loads(sent['messages'][1]['content'])
    assert len(wire['items']) == 3 and set(wire['selected_pick_ids']) == {p.dish.id for p in picks.recommendations}


@pytest.mark.parametrize('mutation', [
    lambda body: body['comparisons'][0].update(favored_item_id='invented'),
    lambda body: body['comparisons'][0].update(favored_quote='Invented ingredients'),
    lambda body: body['comparisons'][0].update(preference_id='invented_taste'),
    lambda body: body.update(restaurant_id='other-branch'),
])
def test_wonder_rejects_fabricated_items_tastes_quotes_and_branch(mutation):
    request, picks = existing_picks()
    transport, _ = wonder_transport(request, picks, mutate=mutation)
    with pytest.raises(CulinaryError, match='comparison'):
        DeepCulinaryReasoner(mock_transport=transport).compare(
            USER, request, picks, proof=SelectionProof(b'p' * 32))


def test_wonder_requires_a_current_signed_snapshot_and_is_off_by_default(monkeypatch, tmp_path):
    request, picks = existing_picks()
    transport, calls = wonder_transport(request, picks)
    request.extraction.recommendation_token = 'invalid'
    with pytest.raises(CulinaryError, match='snapshot'):
        DeepCulinaryReasoner(mock_transport=transport).compare(
            USER, request, picks, proof=SelectionProof(b'p' * 32))
    assert not calls
    request, picks = existing_picks()
    monkeypatch.delenv('DINETUNED_MUSE_WONDER_ENABLED', raising=False)
    picks.mode = 'meta'  # Simulates a saved result; no model request follows.
    with pytest.raises(CulinaryError, match='disabled'):
        DeepCulinaryReasoner(consent=LiveConsent(True, True),
            cache=WonderCache(tmp_path / 'wonder.sqlite3')).compare(
            USER, request, picks, proof=SelectionProof(b'p' * 32))
    assert not (tmp_path / 'wonder.sqlite3').exists()


def test_wonder_price_is_separate_and_old_spark_policy_cannot_select_it(tmp_path):
    request, picks = existing_picks()
    context = WonderContext(build_context(request), picks)
    config = MetaConfig(model='muse-wonder-1.0', reasoning_effort='medium')
    with pytest.raises(CulinaryError, match='model'):
        request_body(context, config, proposal_type=WonderProposal)
    body = request_body(context, config, proposal_type=WonderProposal, allow_wonder=True)
    quote = estimate_request(body)
    assert quote.model == 'muse-wonder-1.0'
    assert quote.input_per_million == Decimal('4.00') and quote.output_per_million == Decimal('20.00')
    budget = UsageBudget(tmp_path / 'usage.json', extra_limits={'4D.WONDER': (Decimal('1'), 1)})
    budget.reserve(quote, '4D.WONDER')
    with pytest.raises(CulinaryError, match='at most 1'):
        budget.reserve(quote, '4D.WONDER')


SAM_TEXT = '<0f>0<|box;x1=2;y1=3;x2=20;y2=25;w=100;h=80|><|mask;x=0;y=0;data=23,19,!!!!!M!0c[0o91w?|>'


def test_sam_parses_official_still_image_box_and_mask_grammar():
    regions = parse_image_output(SAM_TEXT)
    assert len(regions) == 1 and regions[0].box == (2, 3, 20, 25)
    assert regions[0].mask_encoding == 'one_bit' and regions[0].mask_width == 19
    assert parse_image_output('') == []
    for bad in [SAM_TEXT.replace('x2=20', 'x2=200'), SAM_TEXT.replace('h=80', 'h=0'),
                SAM_TEXT.replace('<0f>', '<1f>'), SAM_TEXT + ',0' + SAM_TEXT[4:]]:
        with pytest.raises(CulinaryError): parse_image_output(bad)


def test_sam_uses_original_bounded_image_and_caches_mocked_geometry(tmp_path):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'id': 'offline-sam', 'model': 'sam-3.1',
            'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': SAM_TEXT}]}]})
    segmenter = SamImageSegmenter(mock_transport=httpx.MockTransport(respond),
        cache=SamCache(tmp_path / 'sam.sqlite3'))
    first = segmenter.segment('chickpea-fritters.jpg')
    second = segmenter.segment('chickpea-fritters.jpg')
    assert first == second and first.mode == 'mock' and len(first.regions) == 1 and len(calls) == 1
    sent = json.loads(calls[0].content)
    assert str(calls[0].url) == 'https://api.meta.ai/v1/responses'
    assert sent['model'] == 'sam-3.1' and sent['stream'] is False
    assert sent['input'][0]['content'][0]['text'] == 'food'
    assert sent['input'][0]['content'][1]['image_url'].startswith('data:image/jpeg;base64,')
    with pytest.raises(CulinaryError, match='bundled'):
        segmenter.segment('../private.jpg')


def test_sam_refuses_missing_or_symlinked_artwork_before_transport(tmp_path):
    calls = []
    transport = httpx.MockTransport(lambda request: calls.append(request) or httpx.Response(500))
    segmenter = SamImageSegmenter(mock_transport=transport,
        cache=SamCache(tmp_path / 'sam.sqlite3'), asset_dir=tmp_path)
    with pytest.raises(CulinaryError, match='unavailable'):
        segmenter.segment('chickpea-fritters.jpg')
    (tmp_path / 'chickpea-fritters.jpg').symlink_to(__file__)
    with pytest.raises(CulinaryError, match='unavailable'):
        segmenter.segment('chickpea-fritters.jpg')
    assert not calls and not (tmp_path / 'sam.sqlite3').exists()


def test_sam_live_is_disabled_and_fixed_image_budget_uses_shared_ledger(monkeypatch, tmp_path):
    monkeypatch.delenv('DINETUNED_SAM_ENABLED', raising=False)
    with pytest.raises(CulinaryError, match='disabled'):
        SamImageSegmenter(consent=LiveConsent(True, True),
            cache=SamCache(tmp_path / 'never-created.sqlite3')).segment('chickpea-fritters.jpg')
    assert not (tmp_path / 'never-created.sqlite3').exists()
    budget = UsageBudget(tmp_path / 'usage.json', extra_limits={'4D.SAM': (Decimal('0.005'), 2)})
    first = budget.reserve_sam_image('4D.SAM')
    budget.finish_sam_image(first, success=True)
    second = budget.reserve_sam_image('4D.SAM')
    budget.finish_sam_image(second, success=False)
    assert budget.summary('4D.SAM')['milestone_accounted_usd'] == str(SAM_IMAGE_USD * 2)
    with pytest.raises(CulinaryError, match='exhausted'):
        budget.reserve_sam_image('4D.SAM')


def test_optional_models_have_no_public_routes_and_cli_requires_explicit_flags():
    assert not any('wonder' in path or 'sam' in path for path in app.openapi()['paths'])
    run = subprocess.run([sys.executable, 'scripts/optional_meta.py', 'sam',
        '--asset', 'chickpea-fritters.jpg'], capture_output=True, text=True)
    assert run.returncode != 0 and '--live and --confirm-spend' in run.stderr
