import importlib
import pytest
from pydantic import ValidationError
from app.schemas import (DiningConstraints, DishFeatures, MenuCategory, Price, RecommendationOptions,
                         RecommendationRequest, RecommendationTasteEvidence, TasteAxes, TasteProfile)
from app.services.catalog import get_menu
from app.services.eligibility import evaluate_menu
from app.services.recommendation_ranking import rank_dish

engine = importlib.import_module('app.recommend')
SOURCE = get_menu('saigon-table')
PROFILE = TasteProfile(complete=True, axes=TasteAxes(spice=.5, richness=.5, freshness=.5, crunch=.5))

def dish(identifier, price=1800, intensity=.5):
    item = SOURCE.categories[0].items[0].model_copy(deep=True)
    item.id = identifier
    item.name = identifier
    item.price = Price(amount_minor=price)
    item.sensory = TasteAxes(spice=intensity, richness=intensity, freshness=intensity, crunch=intensity)
    return item

def setup(monkeypatch, dishes, budget=1800, **kwargs):
    menu = SOURCE.model_copy(deep=True)
    menu.categories = [MenuCategory(id='test-category', name='Test dishes', description='Explicit test fixture', items=dishes)]
    for item in dishes:
        item.category_id = 'test-category'
    menu.total_items = len(dishes)
    menu.restaurant.item_count = len(dishes)
    monkeypatch.setattr(engine, 'get_menu', lambda identifier, version: menu)
    req = RecommendationRequest(restaurant_id=menu.restaurant.id, menu_version=menu.version,
        profile=kwargs.pop('profile', PROFILE), constraints=kwargs.pop('constraints', DiningConstraints(max_price_minor=budget)), **kwargs)
    return req, menu

def ids(session):
    return [rec.dish.id for rec in session.recommendations]

def test_within_budget_strong_matches_precede_better_scoring_above_budget_matches(monkeypatch):
    req, menu = setup(monkeypatch, [dish('above', 2200), dish('within', 1800, .7), dish('weak-cheap', 1000, .95)])
    result = engine.recommend(req)
    assert ids(result) == ['within', 'above']
    assert result.recommendations[1].compatibility.score > result.recommendations[0].compatibility.score
    assert result.recommendations[1].budget.overage_minor == 400
    assert result.evaluation == evaluate_menu(menu, req.constraints)
    assert result.evaluation.eligible_count == 2  # Weak cheap dish is still in the complete Smart Menu.
    assert result.qualified_count == 2

@pytest.mark.parametrize('count', [0, 1, 2, 3])
def test_zero_to_three_are_intentional_without_weak_fillers(monkeypatch, count):
    req, _ = setup(monkeypatch, [dish(f'good-{i}') for i in range(count)] + [dish('poor', 100, .95)])
    assert len(engine.recommend(req).recommendations) == count

def test_first_three_within_budget_prevent_over_budget_slot_filling(monkeypatch):
    req, _ = setup(monkeypatch, [dish(f'within-{i}', 1500, .7) for i in range(4)] + [dish('perfect-above', 1900)])
    result = engine.recommend(req)
    assert ids(result) == ['within-0', 'within-1', 'within-2']
    assert all(rec.budget.overage_minor == 0 for rec in result.recommendations)

@pytest.mark.parametrize('target,price,overage', [(1899,1900,1), (1900,1900,0), (0,99999,99999), (100000,99999,0)])
def test_integer_cents_exact_boundary_and_no_arbitrary_stretch_cap(monkeypatch, target, price, overage):
    req, _ = setup(monkeypatch, [dish('match', price)], budget=target)
    rec = engine.recommend(req).recommendations[0]
    assert rec.budget.overage_minor == overage
    assert isinstance(rec.budget.overage_minor, int)
    assert rec.budget.target_minor == target

def test_hiding_above_budget_alternatives_does_not_relax_safety_or_fill_with_weak_dishes(monkeypatch):
    req, _ = setup(monkeypatch, [dish('above', 2000), dish('cheap-weak', 100, .95)], options=RecommendationOptions(include_over_budget=False))
    result = engine.recommend(req)
    assert result.recommendations == []
    assert result.empty_reason == 'over_budget_hidden'
    assert result.above_budget_qualified_count == 1

@pytest.mark.parametrize('reason', ['unavailable', 'unknown-price', 'vegetarian', 'gluten-free', 'allergy', 'other-allergy'])
def test_hard_exclusions_hold_even_for_perfect_above_budget_dishes(monkeypatch, reason):
    item = dish('perfect', 3000)
    constraints = DiningConstraints(max_price_minor=100)
    if reason == 'unavailable': item.available = False
    if reason == 'unknown-price': item.price = Price(amount_minor=None, status='unknown')
    if reason == 'vegetarian': constraints = DiningConstraints(max_price_minor=100, dietary_restrictions=['vegetarian', 'no_pork'])
    if reason == 'gluten-free': constraints = DiningConstraints(max_price_minor=100, dietary_restrictions=['gluten_free'])
    if reason == 'allergy': constraints.allergies.allergens = ['peanut']
    if reason == 'other-allergy': constraints.allergies.other = 'kiwi'
    req, _ = setup(monkeypatch, [item], constraints=constraints)
    result = engine.recommend(req)
    assert result.recommendations == []
    assert result.empty_reason == 'hard_exclusions'

def test_documented_controls_do_not_override_a_listed_allergen_conflict(monkeypatch):
    item = dish('perfect', 2000)
    item.allergens.information_status = 'documented'
    item.allergens.cross_contact = 'documented_controls'
    req, _ = setup(monkeypatch, [item], constraints=DiningConstraints(allergies={'allergens':['fish']}))
    assert engine.recommend(req).recommendations == []

def test_unknown_profile_and_free_text_do_not_become_claims_of_personal_fit(monkeypatch):
    req, _ = setup(monkeypatch, [dish('good')], profile=TasteProfile(favorites='I dislike garlic and love steak'))
    result = engine.recommend(req)
    assert result.recommendations == []
    assert result.empty_reason == 'insufficient_evidence'

def test_structured_favorites_texture_cooking_ingredients_and_dislikes_affect_selection(monkeypatch):
    a, b = dish('a'), dish('b')
    b.features = DishFeatures(family='grill', protein='chicken', textures=['crisp'], cooking_methods=['grilled'])
    b.description = 'Grilled chicken with a crisp edge, garlic and lime.'
    b.ingredients = ['Chicken', 'Garlic', 'Lime']
    notes = RecommendationTasteEvidence(favorite_dishes=['grill'], textures=['crisp'], cooking_methods=['grilled'], liked_ingredients=['citrus'])
    req, _ = setup(monkeypatch, [a, b], taste_evidence=notes)
    assert ids(engine.recommend(req))[0] == 'b'
    evidence = engine.recommend(req).recommendations[0].compatibility.evidence
    assert {'favorite', 'texture', 'cooking', 'ingredient'} <= {item.kind for item in evidence}
    req.taste_evidence.disliked_ingredients = ['garlic']
    assert ids(engine.recommend(req)) == ['a']

def test_session_protein_appetite_and_mood_rank_only_qualified_candidates(monkeypatch):
    a, b, weak = dish('a'), dish('b'), dish('weak', 1000, .95)
    a.features.protein, b.features.protein, weak.features.protein = 'beef', 'chicken', 'chicken'
    b.portion = weak.portion = 'light'
    req, _ = setup(monkeypatch, [a, b, weak], options=RecommendationOptions(protein_preference='chicken'), constraints=DiningConstraints(appetite='light', mood='fresh'))
    assert ids(engine.recommend(req)) == ['b', 'a']
    assert req.profile == PROFILE

def test_unknown_features_and_dislike_absence_are_not_invented(monkeypatch):
    item = dish('match')
    item.features = DishFeatures()
    req, _ = setup(monkeypatch, [item], taste_evidence=RecommendationTasteEvidence(cooking_methods=['steamed'], disliked_ingredients=['garlic']))
    rec = engine.recommend(req).recommendations[0]
    assert not any(e.kind == 'cooking' for e in rec.compatibility.evidence)
    assert any('does not document' in value for value in rec.compatibility.uncertainties)
    assert any('do not prove absence' in value for value in rec.compatibility.uncertainties)

def test_deterministic_ties_and_duplicate_identity_fail_closed(monkeypatch):
    req, menu = setup(monkeypatch, [dish('z'), dish('a'), dish('b')])
    first = engine.recommend(req)
    menu.categories[0].items.reverse()
    second = engine.recommend(req)
    assert first.recommendations == second.recommendations
    assert ids(first) == ['a', 'b', 'z']
    menu.categories[0].items.append(dish('a'))
    assert ids(engine.recommend(req)) == ['b', 'z']

def test_new_evidence_and_options_are_bounded_and_validated():
    with pytest.raises(ValidationError): RecommendationTasteEvidence(cooking_methods=['magic'])
    with pytest.raises(ValidationError): RecommendationTasteEvidence(favorite_dishes=['tacos'] * 7)
    with pytest.raises(ValidationError): RecommendationOptions(protein_preference='unrecognized')
