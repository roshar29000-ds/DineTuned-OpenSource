"""HTML/PDF fixture extraction and mocked Muse Spark; all network is blocked."""
import json
from uuid import uuid4
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.culinary.errors import CulinaryError
from app.culinary.meta import LiveConsent
from app.schemas import TasteProfile, TasteAxes, DiningConstraints, RecommendationTasteEvidence, DietaryRestriction, Allergen
from app.usage_budget import UsageBudget
from app.persistence.routes import get_user, get_repository
from app.persistence.auth import UserIdentity
from app.menu_sources.routes import get_proof
from app.menu_sources.identity import SelectionProof
from app.real_picks import routes
from app.real_picks.authorization import MenuSnapshotPermit
from app.real_picks.context import build_context
from app.real_picks.models import RealPicksRequest, RealCulinaryProposal
from app.real_picks.models import RealMemoryObservation
from app.real_picks.memory import load_memory
from app.persistence.models import DishFeedbackRecord, HistoricalTasteEvidence, DiningEventRecord
from app.persistence.config import PersistenceError
from datetime import datetime, timezone
from app.real_picks.pipeline import recommend
from app.real_picks.provider import MetaRealMenuProvider
from test_menu_extraction import pipeline, request, identity, items, pdf_setup, ROOT, BASE, USER


def fixture(file='orchard-menu.html', name='Orchard Kitchen', address='9 Oak St, Boston, MA 02108'):
    run, _ = pipeline({BASE+'/dinner': (200, 'text/html', (ROOT/file).read_bytes())})
    extraction = run.extract(request(restaurant=identity(name, address)))
    extraction.recommendation_token = MenuSnapshotPermit(SelectionProof(b'p'*32)).issue(extraction, USER)
    return RealPicksRequest(request_id=uuid4(), extraction=extraction,
        profile=TasteProfile(favorites='Grilled chicken with lemon; tomato soup; mushroom rice', axes=TasteAxes(freshness=.7)),
        taste_evidence=RecommendationTasteEvidence(cooking_methods=['grilled'], liked_ingredients=['mushrooms']),
        constraints=DiningConstraints(max_price_minor=2200))


def proposal(req, names=None, fit='exceptional'):
    names = names or ['Charred chicken', 'Mushroom rice', 'Roasted tomato soup']
    menu = req.extraction.menu; by_name = {i.name: i for i in items(req.extraction)}
    return {'restaurant_id': menu.restaurant_id, 'menu_version': menu.version, 'pairings': [], 'candidates': [
        {'item_id': by_name[name].id, 'fit': fit, 'connections': [{'preference_id': 'favorites',
            'field': 'description', 'quote': by_name[name].description}], 'uncertainty': []} for name in names]}


def mocked_provider(body, status=200):
    calls = []
    def handle(request):
        calls.append(request)
        if status != 200: return httpx.Response(status, json={'error': {'message': 'PRIVATE_PROVIDER_DATA'}})
        return httpx.Response(200, json={'id': 'offline-response', 'object': 'chat.completion', 'created': 0,
            'model': 'muse-spark-1.3', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps(body)}}],
            'usage': {'prompt_tokens': 1200, 'completion_tokens': 300, 'total_tokens': 1500}})
    return MetaRealMenuProvider(mock_transport=httpx.MockTransport(handle)), calls


def test_sdk_path_preserves_real_evidence_prices_and_budget_tiers():
    req = fixture(); provider, calls = mocked_provider(proposal(req)); result = recommend(req, provider)
    assert result.mode == 'mock' and result.status == 'ready' and len(calls) == 1
    assert [p.dish.name for p in result.recommendations] == ['Mushroom rice', 'Roasted tomato soup', 'Charred chicken']
    assert [p.price_minor for p in result.recommendations] == [2200, 1200, 2400]
    assert [p.budget.overage_minor for p in result.recommendations] == [0, 0, 200]
    assert all(p.connections[0].evidence.source_hash == req.extraction.menu.sources[0].source_hash for p in result.recommendations)
    assert 'Grilled chicken, lemon and potatoes.' in result.recommendations[-1].explanation
    guest_copy = ' '.join([*(p.explanation for p in result.recommendations),
        *(b.connection for b in result.taste_bridges)])
    assert not any(phrase in guest_copy for phrase in ('You told us', 'Your Taste DNA', 'caught our eye', 'high crunch preference'))
    assert 'current availability is unverified' in ' '.join(result.recommendations[-1].limitations)
    wire = json.loads(calls[0].content); context = json.loads(wire['messages'][1]['content'])
    assert context['menu_version'] == req.extraction.menu.version and context['complete_restaurant_menu'] is False
    assert context['preferences'] and all(d['source_evidence'] for d in context['items'])
    assert wire['reasoning_effort'] == 'minimal' and 'tools' not in wire
    assert provider.client.trace.ledger_request_id is None


@pytest.mark.parametrize('budget,hide,fit,count', [(2200,False,'exceptional',3), (2200,True,'exceptional',2),
    (0,False,'exceptional',3), (0,True,'exceptional',0), (2200,False,'strong',2), (0,False,'strong',0), (3000,False,'tentative',0)])
def test_budget_boundaries_and_quality(budget, hide, fit, count):
    req = fixture(); req.constraints.max_price_minor = budget; req.options.include_over_budget = not hide
    provider, _ = mocked_provider(proposal(req, fit=fit)); result = recommend(req, provider)
    assert len(result.recommendations) == count
    assert all(p.budget.overage_minor == max(0, p.price_minor-budget) for p in result.recommendations)


@pytest.mark.parametrize('count', [0,1,2,3])
def test_zero_to_three_deterministic_selection(count):
    req = fixture(); body = proposal(req); body['candidates'] = body['candidates'][:count]
    provider, _ = mocked_provider(body); one, two = recommend(req, provider), recommend(req, provider)
    assert len(one.recommendations) == count and one == two


@pytest.mark.parametrize('change', ['unknown_id','duplicate','invented_ingredient','other_dish_quote','unknown_preference','negative_preference','dislike'])
def test_unsupported_claims_and_weak_matches_rejected(change):
    req = fixture(); req.taste_evidence.disliked_ingredients = ['cheese']; body = proposal(req, ['Charred chicken']); c = body['candidates'][0]
    if change == 'unknown_id': c['item_id'] = 'invented_food'
    if change == 'duplicate': body['candidates'].append(c.copy())
    if change == 'invented_ingredient': c['connections'][0]['quote'] = 'Peanut-free grilled chicken'
    if change == 'other_dish_quote': c['connections'][0]['quote'] = 'Rice, mushrooms and parsley.'
    if change == 'unknown_preference': c['connections'][0]['preference_id'] = 'loves_cream'
    if change == 'negative_preference': c['connections'][0]['preference_id'] = 'disliked_ingredients_cheese'
    if change == 'dislike': c['uncertainty'] = ['possible_dislike']
    provider, _ = mocked_provider(body); result = recommend(req, provider)
    assert result.status == 'no_matches' and not result.recommendations and result.exclusions


@pytest.mark.parametrize('kind', ['diet', 'combined', 'allergy', 'other_allergy'])
def test_saved_hard_safety_is_not_lost_or_inferred(kind):
    req = fixture()
    if kind == 'diet': req.profile.dietary_restrictions = [DietaryRestriction.vegetarian]
    if kind == 'combined': req.constraints.dietary_restrictions = [DietaryRestriction.vegan,DietaryRestriction.gluten_free]
    if kind == 'allergy': req.profile.allergies.allergens = [Allergen.milk]
    if kind == 'other_allergy': req.constraints.allergies.other = 'kiwi'
    provider, calls = mocked_provider(proposal(req)); result = recommend(req, provider)
    assert result.status == 'no_eligible_items' and not calls
    assert any('diet_unknown' in e.reasons or 'allergen_unknown' in e.reasons for e in result.exclusions)


def test_unknown_taste_requires_refinement_without_model_call():
    req = fixture(); req.profile = TasteProfile(); req.taste_evidence = RecommendationTasteEvidence()
    provider, calls = mocked_provider(proposal(req)); result = recommend(req, provider)
    assert result.status == 'insufficient_taste' and not calls and not result.recommendations


@pytest.mark.parametrize('change', ['duplicate_ids', 'wrong_branch', 'bad_hash'])
def test_corrupt_menu_fails_before_provider(change):
    req = fixture()
    if change == 'duplicate_ids': items(req.extraction)[1].id = items(req.extraction)[0].id
    if change == 'wrong_branch': req.extraction.menu.restaurant_id = 'different_branch'
    if change == 'bad_hash': req.extraction.menu.sources[0].source_hash = 'a'*64
    provider, calls = mocked_provider(proposal(fixture()))
    with pytest.raises(CulinaryError): recommend(req, provider)
    assert not calls


@pytest.mark.parametrize('change', ['unknown_price','currency','unavailable','bad_source','variants','outdated'])
def test_unusable_items_are_not_sent_or_accepted(change):
    req = fixture(); item = next(i for i in items(req.extraction) if i.name == 'Charred chicken')
    if change == 'unknown_price': item.price.budget_usable = False
    if change == 'currency': item.price.options[0].currency = 'CAD'
    if change == 'unavailable': item.availability = 'listed_unavailable'
    if change == 'bad_source': item.evidence_ids = ['missing_evidence']
    if change == 'variants': item.price.kind = 'variants'
    if change == 'outdated': req.extraction.menu.sources[0].candidate.freshness = 'outdated'
    provider, calls = mocked_provider(proposal(req, ['Charred chicken'])); result = recommend(req, provider)
    assert not result.recommendations
    if calls: assert item.id not in {i['id'] for i in json.loads(json.loads(calls[0].content)['messages'][1]['content'])['items']}


def test_signed_snapshot_rejects_changed_price_evidence_owner_and_expiry():
    req = fixture(); proof = SelectionProof(b'p'*32, clock=lambda: 1000); permit = MenuSnapshotPermit(proof)
    req.extraction.recommendation_token = permit.issue(req.extraction, USER); permit.verify(req.extraction, USER)
    with pytest.raises(CulinaryError): permit.verify(req.extraction, uuid4())
    changed = req.extraction.model_copy(deep=True); items(changed)[0].price.options[0].amount_minor += 1
    with pytest.raises(CulinaryError): permit.verify(changed, USER)
    changed = req.extraction.model_copy(deep=True); changed.menu.evidence[0].quote += ' forged'
    with pytest.raises(CulinaryError): permit.verify(changed, USER)
    with pytest.raises(CulinaryError): MenuSnapshotPermit(SelectionProof(b'p'*32, clock=lambda: 4600)).verify(req.extraction, USER)


@pytest.mark.parametrize('status', [401,429,500])
def test_provider_errors_never_retry_or_fallback(status):
    req = fixture(); provider, calls = mocked_provider({}, status); result = recommend(req, provider)
    assert len(calls) == 1 and result.status == 'unavailable' and result.mode == 'not_run'
    assert not result.recommendations and 'PRIVATE_PROVIDER_DATA' not in result.model_dump_json()


def test_stale_and_malformed_output_fail_closed():
    req = fixture()
    for body in [{}, {**proposal(req), 'menu_version': 'old_version'}]:
        provider, calls = mocked_provider(body); result = recommend(req, provider)
        assert result.status == 'unavailable' and not result.recommendations and len(calls) == 1


def test_real_milestone_cannot_borrow_smoke_allowance_or_touch_ledger(monkeypatch, tmp_path):
    req = fixture(); monkeypatch.setenv('MODEL_API_KEY','offline-key')
    budget = UsageBudget(tmp_path/'usage.json'); provider = MetaRealMenuProvider(consent=LiveConsent(), budget=budget)
    with pytest.raises(CulinaryError, match='both --live'): provider.propose(build_context(req))
    assert not budget.path.exists() and not budget.lock_path.exists()


def test_strict_schema_requires_every_property():
    def visit(node):
        if isinstance(node, dict):
            if node.get('type') == 'object':
                assert node['additionalProperties'] is False and set(node['required']) == set(node['properties'])
            for v in node.values(): visit(v)
        elif isinstance(node, list):
            for v in node: visit(v)
    visit(RealCulinaryProposal.model_json_schema())


def test_authenticated_endpoint_binds_menu_and_defaults_to_disabled():
    req = fixture(); client = TestClient(app); app.dependency_overrides[get_proof] = lambda: SelectionProof(b'p'*32)
    class OfflineMemory:
        def evidence(self, offset=0): return []
        def events(self, offset=0): return []
    app.dependency_overrides[get_repository] = lambda: OfflineMemory()
    try:
        assert client.get('/api/v2/real-picks/config').json()['available'] is False
        assert client.post('/api/v2/real-picks/sessions',json=req.model_dump(mode='json')).status_code == 401
        app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
        result = client.post('/api/v2/real-picks/sessions',json=req.model_dump(mode='json'))
        assert result.status_code == 200 and result.json()['error_code'] == 'live_disabled'
        provider, calls = mocked_provider(proposal(req)); app.dependency_overrides[routes.get_provider] = lambda: provider
        result = client.post('/api/v2/real-picks/sessions',json=req.model_dump(mode='json'))
        assert result.status_code == 200 and len(result.json()['recommendations']) == 3 and len(calls) == 1
        assert result.headers['cache-control'] == 'private, no-store'
        bad = req.model_dump(mode='json'); bad['extraction']['menu']['version'] = 'forged'
        assert client.post('/api/v2/real-picks/sessions',json=bad).status_code == 409 and len(calls) == 1
        assert client.post('/api/v2/real-picks/sessions',json={**req.model_dump(mode='json'),'user_id':str(USER)}).status_code == 422
    finally: app.dependency_overrides.clear()


def test_different_cuisine_and_text_pdf_preserve_source_references():
    req = fixture('lantern-menu.html', 'Lantern Noodle', '456 NW Ash Ave, Portland, OR 97209')
    req.profile.favorites = 'Noodle soup with a gentle broth'
    provider, _ = mocked_provider(proposal(req, ['Broth noodles']))
    result = recommend(req, provider)
    assert result.recommendations[0].price_minor == 1825
    assert 'Rice noodles and vegetable broth.' in result.recommendations[0].explanation
    run, pdf_request, _ = pdf_setup(); req.extraction = run.extract(pdf_request)
    req.profile.favorites = 'Lemon grilled chicken and roasted vegetables'
    choices = [i for i in items(req.extraction) if i.description and i.price.budget_usable][:3]
    assert len(choices) == 3
    provider, _ = mocked_provider(proposal(req, [i.name for i in choices]))
    result = recommend(req, provider)
    assert len(result.recommendations) == 3
    assert all(c.evidence.page and c.evidence.method == 'pdf_text' for p in result.recommendations for c in p.connections)
    assert any('PDF layout' in line for p in result.recommendations for line in p.limitations)


def test_timeout_is_one_attempt_and_never_falls_back():
    calls = []
    def timeout(request):
        calls.append(request); raise httpx.ReadTimeout('private-data', request=request)
    provider = MetaRealMenuProvider(mock_transport=httpx.MockTransport(timeout))
    result = recommend(fixture(), provider)
    assert result.status == 'unavailable' and result.error_code == 'provider_timeout' and len(calls) == 1
    assert 'private-data' not in result.model_dump_json() and not result.recommendations


def test_no_silent_menu_sampling_and_no_call_when_context_is_too_large():
    req = fixture(); source = items(req.extraction)[0]
    category = req.extraction.menu.categories[0]
    category.items = [source.model_copy(update={'id': f'large_{i}'}) for i in range(61)]
    req.extraction.menu.categories = [category]; req.extraction.menu.total_items = 61
    provider, calls = mocked_provider({})
    with pytest.raises(CulinaryError, match='No dishes were silently sampled'): recommend(req, provider)
    assert not calls


def test_three_strong_within_budget_always_precede_exceptional_stretch():
    req = fixture(); body = proposal(req, ['Charred chicken','Mushroom rice','Roasted tomato soup','Garden leaves'])
    for c in body['candidates'][1:]: c['fit'] = 'strong'
    provider, _ = mocked_provider(body); result = recommend(req, provider)
    assert [p.dish.name for p in result.recommendations] == ['Mushroom rice','Roasted tomato soup','Garden leaves']
    assert all(p.budget.overage_minor == 0 for p in result.recommendations)


def test_partial_quote_cannot_remove_source_qualifiers():
    req = fixture(); body = proposal(req, ['Charred chicken'])
    body['candidates'][0]['connections'][0]['quote'] = 'Grilled chicken'
    provider, _ = mocked_provider(body)
    assert not recommend(req, provider).recommendations


def test_real_pairing_uses_only_validated_menu_items_and_exact_cents():
    req = fixture(); body = proposal(req, ['Charred chicken'])
    by_name = {item.name: item for item in items(req.extraction)}
    main = by_name['Charred chicken'].id
    soup, rice = by_name['Roasted tomato soup'].id, by_name['Mushroom rice'].id
    body['pairings'] = [{'main_id': main, 'addition_ids': [soup, rice]}]
    provider, calls = mocked_provider(body); result = recommend(req, provider)
    assert len(calls) == 1 and len(result.recommendations) == 1
    assert len(result.meal_combinations) == 1
    table = result.meal_combinations[0]
    assert table.main_item_id == main and table.subtotal_minor == 5800
    assert [a.price_minor for a in table.additions] == [1200, 2200]
    assert all(a.evidence.source_hash == req.extraction.menu.sources[0].source_hash for a in table.additions)
    assert table.additions[0].dish.name in table.rationale
    bridge = next(b for b in result.taste_bridges if b.item_id == main)
    assert bridge.anchor.id == 'favorites' and bridge.evidence.source_hash == req.extraction.menu.sources[0].source_hash
    assert 'not proof' in bridge.uncertainty


@pytest.mark.parametrize('addition_ids', [['invented'], ['SAME'], ['REPEAT', 'REPEAT']])
def test_invalid_or_duplicate_pairing_never_suppresses_primary(addition_ids):
    req = fixture(); body = proposal(req, ['Charred chicken'])
    by_name = {item.name: item for item in items(req.extraction)}
    main = by_name['Charred chicken'].id
    ids = [main if i == 'SAME' else by_name['Roasted tomato soup'].id if i == 'REPEAT' else i for i in addition_ids]
    body['pairings'] = [{'main_id': main, 'addition_ids': ids}]
    result = recommend(req, mocked_provider(body)[0])
    assert len(result.recommendations) == 1 and not result.meal_combinations


def test_missing_pairings_field_is_invalid_model_json_not_an_implicit_empty_result():
    req = fixture(); body = proposal(req, ['Charred chicken']); del body['pairings']
    result = recommend(req, mocked_provider(body)[0])
    assert result.status == 'unavailable' and result.error_code == 'malformed_output'
    assert not result.recommendations


def test_extra_exceptional_stretch_is_distinct_and_hidden_with_overages():
    req = fixture(); req.constraints.max_price_minor = 1300
    body = proposal(req, ['Roasted tomato soup', 'Charred chicken', 'Mushroom rice', 'Garden leaves'])
    result = recommend(req, mocked_provider(body)[0])
    assert [p.dish.name for p in result.recommendations] == ['Roasted tomato soup', 'Charred chicken', 'Mushroom rice']
    assert [p.dish.name for p in result.worth_the_stretch] == ['Garden leaves']
    assert result.worth_the_stretch[0].budget.overage_minor == 150
    assert not {p.dish.id for p in result.worth_the_stretch} & {p.dish.id for p in result.recommendations}
    req.options.include_over_budget = False
    hidden = recommend(req, mocked_provider(body)[0])
    assert len(hidden.recommendations) == 1 and not hidden.worth_the_stretch


def test_refinement_changes_model_context_and_excludes_prior_dishes_without_downgrading_safety():
    req = fixture(); previous = next(i for i in items(req.extraction) if i.name == 'Mushroom rice')
    req.refinements.preferences = ['spicier', 'lighter']
    req.refinements.avoid_dish_ids = [previous.id]
    body = proposal(req, ['Mushroom rice', 'Charred chicken'])
    provider, calls = mocked_provider(body); result = recommend(req, provider)
    assert [p.dish.name for p in result.recommendations] == ['Charred chicken']
    assert any('refinement_avoided' in x.reasons for x in result.exclusions)
    context = json.loads(json.loads(calls[0].content)['messages'][1]['content'])
    assert context['refinements']['preferences'] == ['spicier', 'lighter']
    assert previous.id not in {i['id'] for i in context['items']}
    req.refinements.avoid_dish_ids = ['invented']
    with pytest.raises(CulinaryError, match='outside this menu'): recommend(req, provider)


def test_no_unseen_strong_dish_is_honest_and_reset_restores_selection():
    req = fixture(); chosen = next(i for i in items(req.extraction) if i.name == 'Mushroom rice')
    req.refinements.avoid_dish_ids = [chosen.id]
    empty = proposal(req, []); empty['candidates'] = []
    result = recommend(req, mocked_provider(empty)[0])
    assert result.status == 'no_matches' and not result.recommendations
    assert 'No unseen strong dishes remain' in result.message
    req.refinements.avoid_dish_ids = []
    reset = recommend(req, mocked_provider(proposal(req, ['Mushroom rice']))[0])
    assert reset.recommendations[0].dish.id == chosen.id


def test_reported_memory_is_owned_scoped_and_does_not_infer_saving_means_liking():
    req = fixture(); menu = req.extraction.menu; soup = next(i for i in items(req.extraction) if i.name == 'Roasted tomato soup')
    now = datetime.now(timezone.utc)
    event = DiningEventRecord(id=uuid4(), user_id=USER, created_at=now, updated_at=now, source='user_reported',
        event_type='saved', restaurant_id=menu.restaurant_id, menu_version=menu.version,
        dish_id=soup.id, occurred_at=now, recommendation_id=None, restaurant_name='Orchard Kitchen', dish_name=soup.name)
    feedback = DishFeedbackRecord(id=uuid4(), user_id=USER, created_at=now, updated_at=now, source='user_reported',
        event_id=None, feedback={'id':'note_1','restaurant_id':menu.restaurant_id,'restaurant_name':'Orchard Kitchen',
            'dish_id':soup.id,'dish_name':soup.name,'liked':False,'note':'Too sweet for me',
            'date':now,'menu_version':menu.version}, rating=2, tags=['too_heavy'])
    report = HistoricalTasteEvidence(feedback=feedback, event=None, recommendation=None,
        consumption_confirmed=False, uncertainty=['Consumption not confirmed'])
    class Memory:
        def evidence(self, offset=0): return [report]
        def events(self, offset=0): return [event]
    memory, warning = load_memory(Memory(), USER)
    assert warning is None and len(memory) == 2
    assert memory[0].polarity == 'dislike' and memory[1].polarity == 'neutral'
    provider, calls = mocked_provider(proposal(req, ['Roasted tomato soup']))
    result = recommend(req, provider, memory=memory)
    assert not result.recommendations and any('reported_dislike' in e.reasons for e in result.exclusions)
    assert calls and all(i['id'] != soup.id for i in json.loads(json.loads(calls[0].content)['messages'][1]['content'])['items'])
    feedback.user_id = uuid4()
    with pytest.raises(CulinaryError, match='ownership'): load_memory(Memory(), USER)


def test_positive_memory_is_a_reported_anchor_and_cloud_failure_is_visible():
    req = fixture(); now = datetime.now(timezone.utc); dish = next(i for i in items(req.extraction) if i.name == 'Mushroom rice')
    feedback = DishFeedbackRecord(id=uuid4(), user_id=USER, created_at=now, updated_at=now,
        source='user_reported', event_id=None, feedback={'id':'note_positive',
            'restaurant_id':req.extraction.menu.restaurant_id, 'restaurant_name':'Orchard Kitchen',
            'dish_id':dish.id, 'dish_name':dish.name, 'liked':True, 'note':'Loved the texture',
            'date':now, 'menu_version':req.extraction.menu.version}, rating=5, tags=['great_texture'])
    report = HistoricalTasteEvidence(feedback=feedback, event=None, recommendation=None,
        consumption_confirmed=False, uncertainty=['Consumption not confirmed'])
    class Memory:
        def evidence(self, offset=0): return [report]
        def events(self, offset=0): return []
    observations, _ = load_memory(Memory(), USER)
    req.profile = TasteProfile(); req.taste_evidence = RecommendationTasteEvidence()
    body = proposal(req, ['Mushroom rice'])
    body['candidates'][0]['connections'][0]['preference_id'] = observations[0].id
    provider, calls = mocked_provider(body)
    result = recommend(req, provider, memory=observations)
    assert len(result.recommendations) == 1 and len(calls) == 1
    assert result.taste_bridges[0].anchor.source == 'taste_memory'
    assert 'reported liking' in result.taste_bridges[0].connection
    feedback.rating = 1
    contradictory, _ = load_memory(Memory(), USER)
    assert contradictory[0].polarity == 'neutral'
    assert recommend(req, provider, memory=contradictory).status == 'insufficient_taste'
    class Broken:
        def evidence(self, offset=0): raise PersistenceError(503, 'offline')
    memory, warning = load_memory(Broken(), USER)
    assert not memory and 'could not be read' in warning
