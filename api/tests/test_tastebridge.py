from copy import deepcopy
import importlib
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.schemas import BridgeProposal, RecommendationRequest
from app.services.catalog import get_menu
from app.tastebridge.context import build_context
from app.tastebridge.reasoning import DemoTasteBridgeReasoner
from app.tastebridge.service import build_taste_bridge
from app.tastebridge.validation import validate_proposal

recommend_module = importlib.import_module('app.recommend')
client = TestClient(app)

def request(restaurant='sora-kitchen', profile=None, notes=None, feedback=None, constraints=None):
    menu = get_menu(restaurant)
    return RecommendationRequest(restaurant_id=restaurant, menu_version=menu.version, constraints=constraints or {},
        profile=profile if profile is not None else {'axes': {'spice': .6, 'richness': .9, 'crunch': .2, 'aromatic': .85}},
        taste_evidence=notes or {}, bridge_feedback=feedback or [])

def memory(restaurant='saigon-table', dish='pho', **changes):
    return {'id': 'rating', 'restaurant_id': restaurant, 'dish_id': dish, 'menu_version': get_menu(restaurant).version,
        'liked': True, 'date': '2026-10-20T12:00:00Z', **changes}

def target(req, identifier):
    menu = get_menu(req.restaurant_id)
    return menu, next(d for c in menu.categories for d in c.items if d.id == identifier)

def bridge(req, identifier, **kwargs):
    return build_taste_bridge(req, *target(req, identifier), **kwargs)

def test_actual_cross_cuisine_feedback_connection_has_shared_traits_and_differences():
    req = request(feedback=[memory()])
    result = bridge(req, 'miso-ramen')
    assert result.status == 'grounded'
    assert result.anchor.kind == 'liked_dish'
    assert 'Pho Gà at Saigon Table' in result.explanation
    assert any(c.attribute == 'family' and c.relation == 'shared' for c in result.shared)
    assert any(c.attribute == 'spice' and c.relation == 'higher' for c in result.differences)
    assert any(f.source == 'reported_feedback' and f.feedback_id == 'rating' for f in result.evidence)
    facts = {f.id: f for f in result.evidence}
    for comparison in [*result.shared, *result.differences]:
        assert comparison.anchor_fact_id in facts and comparison.target_fact_id in facts
        assert facts[comparison.target_fact_id].dish_id == 'miso-ramen'
        assert facts[comparison.target_fact_id].menu_version == req.menu_version
    assert any('does not tell us which qualities' in line for line in result.uncertainties)
    assert not any(f.attribute in {'umami', 'sweetness'} for f in result.evidence)
    assert 'little crunch' in result.explanation
    assert 'softer textures' not in result.explanation

def test_different_families_can_connect_via_documented_texture():
    req = request('luna-trattoria', feedback=[memory('spice-garden', 'butter-chicken')])
    result = bridge(req, 'spicy-rigatoni')
    assert result.anchor.kind == 'liked_dish'
    assert any(c.attribute == 'texture' for c in result.shared)
    assert any(c.attribute == 'family' and c.relation == 'different' for c in result.differences)
    assert 'tender' in result.explanation

def test_saved_preferences_support_limited_bridge_without_inventing_favorite_dish_traits():
    req = request('saigon-table', profile={'axes': {}}, notes={'cooking_methods': ['grilled'], 'liked_ingredients': ['citrus']})
    result = bridge(req, 'lemongrass')
    assert result.status == 'limited'
    assert {c.attribute for c in result.shared} == {'cooking', 'ingredient'}
    assert 'Lime' in result.explanation
    assert not any(f.source == 'reported_feedback' for f in result.evidence)
    assert any('not a verified sensory profile' in line for line in result.uncertainties)

def test_unknown_and_unrelated_preferences_do_not_invent_a_connection():
    assert bridge(request(profile={'axes': {}}), 'miso-ramen').unavailable_reason == 'insufficient_evidence'
    req = request(profile={'axes': {}}, notes={'favorite_dishes': ['salad']})
    result = bridge(req, 'miso-ramen')
    assert result.status == 'unavailable' and not result.explanation and not result.shared
    assert bridge(request(profile={'favorites': 'Chicken tikka for its smoky char', 'axes': {}}), 'miso-ramen').status == 'unavailable'

@pytest.mark.parametrize('change', [{'menu_version': None}, {'menu_version': 'obsolete'}, {'restaurant_id': 'missing'}, {'dish_id': 'missing'}])
def test_old_or_unresolvable_feedback_never_supplies_historical_attributes(change):
    req = request(profile={'axes': {}}, feedback=[memory(**change)])
    result = bridge(req, 'miso-ramen')
    assert result.status == 'unavailable'
    assert not result.evidence

def test_future_and_contradictory_feedback_cannot_become_positive_anchors():
    for history in [[memory(date='2999-01-01T00:00:00Z')], [memory(), memory(id='negative', liked=False)]]:
        assert bridge(request(profile={'axes': {}}, feedback=history), 'miso-ramen').status == 'unavailable'

def test_same_dish_feedback_is_not_an_unfamiliar_food_bridge():
    req = request(profile={'axes': {}}, feedback=[memory('sora-kitchen', 'miso-ramen')])
    assert bridge(req, 'miso-ramen').status == 'unavailable'

def test_negative_target_feedback_suppresses_only_bridge_not_recommendation():
    base = request()
    negative = request(feedback=[memory('sora-kitchen', 'miso-ramen', liked=False)])
    before, after = recommend_module.recommend(base), recommend_module.recommend(negative)
    assert [r.model_dump(exclude={'taste_bridge'}) for r in before.recommendations] == [r.model_dump(exclude={'taste_bridge'}) for r in after.recommendations]
    rec = next(r for r in after.recommendations if r.dish.id == 'miso-ramen')
    assert rec.taste_bridge.unavailable_reason == 'contradictory_evidence'

def test_contradictory_ingredient_preferences_are_not_positive_evidence():
    req = request('saigon-table', notes={'liked_ingredients': ['citrus'], 'disliked_ingredients': ['citrus']})
    assert bridge(req, 'lemongrass').unavailable_reason == 'contradictory_evidence'

@pytest.mark.parametrize('constraints', [{'allergies': {'allergens': ['peanut']}}, {'dietary_restrictions': ['vegetarian']}])
def test_bridge_cannot_override_hard_safeguards(constraints):
    assert bridge(request(constraints=constraints, feedback=[memory()]), 'miso-ramen').unavailable_reason == 'ineligible'

def test_wrong_menu_or_dish_identity_cannot_be_bridged():
    req = request()
    menu, dish = target(req, 'miso-ramen')
    req.menu_version = 'stale'
    assert build_taste_bridge(req, menu, dish).status == 'unavailable'
    req.menu_version = menu.version
    invented = dish.model_copy(update={'description': 'Made up'})
    assert build_taste_bridge(req, menu, invented).status == 'unavailable'

@pytest.mark.parametrize('attack', ['anchor', 'dish', 'reference', 'false_similarity', 'duplicate', 'prose', 'wrong_subject'])
def test_unsupported_provider_claims_are_rejected(attack):
    req = request(feedback=[memory()])
    context = build_context(req, *target(req, 'miso-ramen'))
    raw = DemoTasteBridgeReasoner().propose(context).model_dump()
    if attack == 'anchor': raw['anchor_id'] = 'chicken-tikka-invented'
    if attack == 'dish': raw['dish_id'] = 'another-dish'
    if attack == 'reference': raw['shared'][0]['anchor_fact_id'] = 'fictional-evidence'
    if attack == 'false_similarity': raw['shared'] = [{**raw['differences'][0], 'relation': 'shared'}]
    if attack == 'duplicate': raw['shared'].append(raw['shared'][0])
    if attack == 'prose': raw['explanation'] = 'Allergen safe and you love its invented smoky char.'
    if attack == 'wrong_subject': raw['shared'][0]['anchor_fact_id'] = raw['shared'][0]['target_fact_id']
    with pytest.raises((ValueError, ValidationError)):
        validate_proposal(raw, context, 'test-provider')

def test_unknown_absence_cannot_be_presented_as_an_ingredient_difference():
    req = request('saigon-table', notes={'liked_ingredients': ['citrus', 'cheese'], 'cooking_methods': ['grilled']})
    context = build_context(req, *target(req, 'lemongrass'))
    proposal = DemoTasteBridgeReasoner().propose(context)
    cheese = next(f for f in context.facts if f.subject == 'user' and f.value == 'cheese')
    lime = next(f for f in context.facts if f.subject == 'target' and f.value == 'citrus')
    raw = proposal.model_dump()
    raw['differences'] = [{'anchor_fact_id': cheese.id, 'target_fact_id': lime.id, 'relation': 'different'}]
    with pytest.raises(ValueError): validate_proposal(raw, context, 'test-provider')

def test_provider_failure_and_context_mutation_do_not_poison_trusted_facts():
    req = request('saigon-table', profile={'axes': {}}, notes={'cooking_methods': ['grilled']})
    class Broken:
        name = 'test-provider'
        def propose(self, context): raise RuntimeError('offline')
    assert bridge(req, 'lemongrass', reasoner=Broken()).unavailable_reason == 'provider_unavailable'
    class Unsupported:
        name = 'test-provider'
        def propose(self, context): return {'explanation': 'You love its allergen-free smoky char.'}
    assert bridge(req, 'lemongrass', reasoner=Unsupported()).unavailable_reason == 'invalid_proposal'
    class Mutating:
        name = 'test-provider'
        def propose(self, context):
            for fact in context.facts:
                if fact.attribute == 'cooking':
                    fact.value, fact.label = 'fried', 'invented fried preparation'
            return DemoTasteBridgeReasoner().propose(context)
    result = bridge(req, 'lemongrass', reasoner=Mutating())
    assert 'grilled' in result.explanation and 'fried' not in result.explanation
    assert all(f.value != 'fried' for f in result.evidence)

@pytest.mark.parametrize('restaurant', ['saigon-table', 'saigon-table-river-north', 'casa-sol', 'luna-trattoria', 'sora-kitchen', 'spice-garden'])
def test_bridge_addition_never_changes_ranking_budget_price_or_legacy_response(restaurant):
    req = request(restaurant, profile={'axes': {'spice': .18, 'richness': .7, 'freshness': .5, 'crunch': .8}}, constraints={'max_price_minor': 1899})
    original = recommend_module.recommend(req)
    with_history = deepcopy(req)
    with_history.bridge_feedback = RecommendationRequest.model_validate({**req.model_dump(), 'bridge_feedback': [memory()]}).bridge_feedback
    enriched = recommend_module.recommend(with_history)
    assert original.evaluation == enriched.evaluation
    assert [r.model_dump(exclude={'taste_bridge'}) for r in original.recommendations] == [r.model_dump(exclude={'taste_bridge'}) for r in enriched.recommendations]
    assert len(enriched.recommendations) <= 3

def test_api_contract_accepts_old_requests_and_returns_versioned_bridge_with_legacy_fields():
    req = request('spice-garden', profile={'axes': {'aromatic': .85}}, notes={'favorite_dishes': ['curry']})
    body = req.model_dump(mode='json'); del body['bridge_feedback']
    response = client.post('/api/v2/recommendation-sessions', json=body)
    assert response.status_code == 200
    result = response.json()
    assert result['bridge_feedback'] == []
    assert [r['dish']['id'] for r in result['recommendations']] == ['chana-masala', 'butter-chicken']
    for rec in result['recommendations']:
        assert {'connection', 'contrast', 'evidence', 'uncertainty'} <= rec['bridge'].keys()
        assert rec['taste_bridge']['schema_version'] == 1
        assert rec['taste_bridge']['dish_id'] == rec['dish']['id']
        assert rec['taste_bridge']['menu_version'] == result['menu_version']
        assert rec['taste_bridge']['provider'] == 'structured_demo_v1'
    body['bridge_feedback'] = [memory()] * 21
    assert client.post('/api/v2/recommendation-sessions', json=body).status_code == 422
