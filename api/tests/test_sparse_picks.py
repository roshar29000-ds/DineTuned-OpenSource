"""Focused regression cases for evidence coverage, not lower score thresholds."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas import RecommendationRequest
from app.services.catalog import get_menu
from app.services.recommendation_ranking import rank_dish

client = TestClient(app)

def request(restaurant='spice-garden', axes=None, notes=None, constraints=None, **options):
    menu = get_menu(restaurant)
    return RecommendationRequest(restaurant_id=restaurant, menu_version=menu.version,
        profile={'complete': True, 'axes': axes if axes is not None else {'aromatic': .85}},
        taste_evidence=notes if notes is not None else {'favorite_dishes': ['curry']},
        constraints=constraints or {}, options=options)

def session(req):
    response = client.post('/api/v2/recommendation-sessions', json=req.model_dump(mode='json'))
    assert response.status_code == 200, response.text
    return response.json()

@pytest.mark.parametrize('restaurant,axes,notes,expected', [
    ('spice-garden', {'aromatic': .85}, {'favorite_dishes': ['curry']}, ['chana-masala', 'butter-chicken']),
    ('luna-trattoria', {'richness': .87}, {'favorite_dishes': ['pasta']}, ['pesto-gnocchi', 'spicy-rigatoni']),
    ('sora-kitchen', {'richness': .87}, {'favorite_dishes': ['ramen']}, ['miso-ramen']),
])
def test_one_strong_known_dimension_and_independent_favorite_qualify(restaurant, axes, notes, expected):
    req = request(restaurant, axes, notes)
    result = session(req)
    assert [rec['dish']['id'] for rec in result['recommendations']] == expected
    assert result['profile'] == req.profile.model_dump(mode='json')
    assert result['taste_evidence'] == req.taste_evidence.model_dump(mode='json')
    for rec in result['recommendations']:
        assert {e['kind'] for e in rec['compatibility']['evidence']} >= {'favorite', 'sensory'}
        assert any('Limited taste coverage' in line for line in rec['compatibility']['uncertainties'])
        assert rec['compatibility']['label'] == 'Thoughtful match'

def test_sparse_dietary_matches_and_exact_overages_keep_the_same_policy():
    req = request(constraints={'max_price_minor': 1799, 'dietary_restrictions': ['vegetarian', 'no_pork']})
    result = session(req)
    assert [rec['dish']['id'] for rec in result['recommendations']] == ['chana-masala']
    assert result['recommendations'][0]['budget'] == {'target_minor': 1799, 'overage_minor': 1, 'status': 'above_target'}
    assert result['evaluation']['eligible_count'] == 0
    req.options.include_over_budget = False
    assert session(req)['empty_reason'] == 'over_budget_hidden'

@pytest.mark.parametrize('constraints', [
    {'allergies': {'allergens': ['peanut']}},
    {'allergies': {'other': 'kiwi'}},
    {'dietary_restrictions': ['gluten_free']},
])
def test_sparse_matches_never_bypass_unknown_allergens_or_dietary_evidence(constraints):
    result = session(request(constraints=constraints))
    assert result['recommendations'] == []
    assert result['empty_reason'] == 'hard_exclusions'

@pytest.mark.parametrize('axes,notes', [({}, {}), ({'aromatic': .85}, {}), ({'umami': .85}, {'favorite_dishes': ['curry']})])
def test_missing_shared_evidence_is_not_reported_as_poor_taste_fit(axes, notes):
    result = session(request(axes=axes, notes=notes))
    assert result['recommendations'] == []
    assert result['empty_reason'] == 'insufficient_evidence'
    assert 'heat' in result['message']  # An answer the fixture can actually compare.

def test_matching_texture_and_its_crunch_value_are_not_two_independent_clues():
    req = request('sora-kitchen', {'crunch': .82}, {'textures': ['crisp'], 'cooking_methods': ['fried']})
    dish = next(d for c in get_menu('sora-kitchen').categories for d in c.items if d.id == 'tofu-don').model_copy(deep=True)
    dish.features.cooking_methods = ['fried']  # Even with this explicit test annotation, it is one texture signal.
    ranked = rank_dish(dish, req)
    assert not ranked.qualified
    assert ranked.rejection_reason == 'insufficient_evidence'

def test_duplicate_ingredient_and_inferred_axis_do_not_inflate_evidence():
    req = request('saigon-table', {'aromatic': .8}, {'liked_ingredients': ['herbs'], 'inferred_axes': ['aromatic']})
    result = session(req)
    assert result['recommendations'] == []
    assert result['empty_reason'] == 'insufficient_evidence'

def test_known_weak_match_and_dislikes_are_poor_matches_even_with_favorite_evidence():
    menu = get_menu('spice-garden')
    dish = next(d for c in menu.categories for d in c.items if d.id == 'chana-masala')
    req = request(axes={'aromatic': .5})  # Difference .41: score 590, below unchanged 750.
    assert rank_dish(dish, req).rejection_reason == 'poor_match'
    req = request(axes={'aromatic': .91}, notes={'favorite_dishes': ['curry'], 'disliked_ingredients': ['garlic']})
    disliked = dish.model_copy(deep=True)
    disliked.ingredients = [*dish.ingredients, 'Garlic']
    assert rank_dish(disliked, req).rejection_reason == 'poor_match'

def test_completely_opposed_detailed_profile_keeps_a_legitimate_zero():
    result = session(request(axes={'spice': 0, 'richness': 0, 'freshness': 1, 'crunch': 1, 'aromatic': 0}))
    assert result['recommendations'] == []
    assert result['empty_reason'] == 'no_strong_matches'

def test_extra_known_conflicts_are_not_ignored_by_the_sparse_route():
    req = request(axes={'aromatic': .85, 'crunch': 1})
    dish = next(d for c in get_menu('spice-garden').categories for d in c.items if d.id == 'butter-chicken')
    assert not rank_dish(dish, req).qualified
    assert rank_dish(dish, req).rejection_reason == 'poor_match'

@pytest.mark.parametrize('preference,qualified', [(.66, True), (.659, False)])
def test_sparse_matches_keep_the_existing_750_score_boundary(preference, qualified):
    req = request(axes={'aromatic': preference})
    dish = next(d for c in get_menu('spice-garden').categories for d in c.items if d.id == 'chana-masala')
    assert rank_dish(dish, req).qualified is qualified

def test_detailed_profile_selection_is_preserved():
    result = session(request('saigon-table', {'spice': .18, 'richness': .7, 'freshness': .5, 'crunch': .8}, {}))
    assert [rec['dish']['id'] for rec in result['recommendations']] == ['pho', 'banh-mi', 'lemongrass']
