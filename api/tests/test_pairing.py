from copy import deepcopy
import importlib
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.schemas import (Allergen, AllergenEvidence, DietaryRestriction, MealCombinationResult, Price, RecommendationRequest, RestaurantMenu)
from app.services.catalog import get_menu
from app.pairing.context import build_context
from app.pairing.reasoning import DemoMealPairingReasoner
from app.pairing.service import build_meal_combinations
from app.pairing.validation import validate_proposal

recommend_module = importlib.import_module('app.recommend')
client = TestClient(app)


def request(restaurant='sora-kitchen', **changes):
    axes = {'spice': .6, 'richness': .9, 'crunch': .2, 'aromatic': .85}
    if restaurant.startswith('saigon'):
        axes = {'spice': .2, 'richness': .6, 'aromatic': .85}
    return RecommendationRequest.model_validate({'restaurant_id': restaurant, 'menu_version': get_menu(restaurant).version,
        'constraints': {'max_price_minor': 2000}, 'profile': {'axes': axes}, **changes})


def setup(req=None):
    req = req or request()
    menu = get_menu(req.restaurant_id).model_copy(deep=True)
    primary = recommend_module.recommend(req).recommendations
    return req, menu, primary


def proposed(req=None):
    req, menu, primary = setup(req)
    context = build_context(req, menu, primary)
    proposal = DemoMealPairingReasoner().propose(context)[0]
    return context, proposal


def item(menu, key):
    return next(d for c in menu.categories for d in c.items if d.id == key)


@pytest.mark.parametrize('restaurant', ['saigon-table', 'saigon-table-river-north', 'sora-kitchen', 'casa-sol', 'luna-trattoria', 'spice-garden', 'olive-ember'])
def test_actual_demo_combinations_use_only_current_menu_items_and_exact_totals(restaurant):
    req = request(restaurant)
    session = recommend_module.recommend(req)
    result = session.meal_combinations
    assert result.restaurant_id == restaurant and result.menu_version == req.menu_version
    assert result.provider == 'structured_demo_pairing_v1' and result.mode == 'demo'
    assert 0 < len(result.combinations) <= len(session.recommendations) <= 3
    menu = get_menu(restaurant)
    mains = {rec.dish.id for rec in session.recommendations}
    seen = set()
    for combo in result.combinations:
        assert combo.main.item_id in mains
        parts = [combo.main, *combo.additions]
        ids = frozenset(part.item_id for part in parts)
        assert len(ids) == len(parts) and ids not in seen
        seen.add(ids)
        assert combo.subtotal_minor == sum(part.price_minor for part in parts)
        assert combo.price_basis == 'menu_subtotal_before_tax_tip_fees'
        assert combo.budget_scope == 'per_dish_not_meal_cap'
        # The per-dish target is not treated as a meal cap, whether the
        # resulting subtotal falls above or below it.
        assert combo.subtotal_minor >= combo.main.price_minor
        for part in parts:
            dish = item(menu, part.item_id)
            assert part.price_minor == dish.price.amount_minor
            assert part.category_id == dish.category_id
            assert part.category_name == next(c.name for c in menu.categories if c.id == part.category_id)
            assert part.budget.overage_minor == max(0, part.price_minor - 2000)
        facts = {fact.id: fact for fact in combo.evidence}
        for claim in combo.claims:
            assert claim.left_fact_id in facts and claim.right_fact_id in facts
        assert 'allergy-safety' in ' '.join(combo.uncertainties)


def test_primary_overage_and_even_zero_dollar_target_are_not_meal_caps():
    result = recommend_module.recommend(request()).meal_combinations
    ramen = next(c for c in result.combinations if c.main.item_id == 'miso-ramen')
    assert ramen.main.price_minor == 2200 and ramen.main.budget.overage_minor == 200
    assert [(d.item_id, d.price_minor) for d in ramen.additions] == [('gyoza', 1300)]
    assert ramen.subtotal_minor == 3500
    zero = recommend_module.recommend(request(constraints={'max_price_minor': 0})).meal_combinations
    assert [c.subtotal_minor for c in zero.combinations] == [c.subtotal_minor for c in result.combinations]
    assert all(c.main.budget.overage_minor == c.main.price_minor for c in zero.combinations)
    hidden = recommend_module.recommend(request(constraints={'max_price_minor': 0}, options={'include_over_budget': False}))
    assert hidden.recommendations == [] and hidden.meal_combinations.unavailable_reason == 'no_primary_picks'


def test_variation_uses_alternative_small_plates_and_is_deterministic():
    req = request('saigon-table')
    first = recommend_module.recommend(req).meal_combinations
    assert first == recommend_module.recommend(req).meal_combinations
    assert len({c.additions[0].item_id for c in first.combinations}) >= 1
    assert len({frozenset([c.main.item_id, *(d.item_id for d in c.additions)]) for c in first.combinations}) == len(first.combinations)


def test_no_primary_picks_never_invokes_provider():
    class Never:
        name, mode = 'never', 'demo'
        def propose(self, context):
            pytest.fail('No primary, no pairing request')
    req = request()
    result = build_meal_combinations(req, get_menu(req.restaurant_id), [], Never())
    assert result.combinations == [] and result.unavailable_reason == 'no_primary_picks'


@pytest.mark.parametrize('restrictions', [['vegetarian'], ['vegetarian', 'no_pork'], ['vegan', 'dairy_free']])
def test_combined_saved_and_session_dietary_constraints_remain_hard(restrictions):
    req = request('saigon-table', constraints={'dietary_restrictions': restrictions[1:]},
        profile={'axes': {'spice': .2, 'richness': .4, 'crunch': .8}, 'dietary_restrictions': restrictions[:1]})
    session = recommend_module.recommend(req)
    assert session.recommendations
    for combo in session.meal_combinations.combinations:
        for part in [combo.main, *combo.additions]:
            dietary = {e.restriction: e.status for e in item(get_menu(req.restaurant_id), part.item_id).dietary}
            assert all(dietary[r] == 'supported' for r in restrictions)


@pytest.mark.parametrize('change', ['unknown_price', 'unavailable', 'unknown_diet', 'conflicting_diet', 'unknown_allergens', 'cross_contact', 'allergen', 'may_contain', 'other_allergy'])
def test_invalid_accompaniment_cannot_supply_a_combination(change):
    req, menu, primary = setup()
    original = DemoMealPairingReasoner().propose(build_context(req, menu, primary))[0]
    side = item(menu, 'gyoza')
    if change == 'unknown_price':
        side.price = Price(amount_minor=None, status='unknown')
    elif change == 'unavailable':
        side.available = False
    elif change in {'unknown_diet', 'conflicting_diet'}:
        req.constraints.dietary_restrictions = [DietaryRestriction.no_beef]
        evidence = next(e for e in side.dietary if e.restriction == 'no_beef')
        evidence.status = 'unknown' if change == 'unknown_diet' else 'conflict'
    else:
        # Only test fixtures gain controls here; production menus remain partial.
        for category in menu.categories:
            for dish in category.items:
                dish.allergens = AllergenEvidence(information_status='documented', cross_contact='documented_controls')
        req.profile.allergies.allergens = [Allergen.peanut]
        if change == 'unknown_allergens': side.allergens.information_status = 'unknown'
        if change == 'cross_contact': side.allergens.cross_contact = 'unknown'
        if change == 'allergen': side.allergens.contains = [Allergen.peanut]
        if change == 'may_contain': side.allergens.may_contain = [Allergen.peanut]
        if change == 'other_allergy': req.profile.allergies.other = 'kiwi'
    # Validate edited fixtures just like API input (including enum conversion).
    req = RecommendationRequest.model_validate(req.model_dump())
    menu = RestaurantMenu.model_validate(menu.model_dump())
    # Match primary snapshots to the test's changed menu, never accept stale ones.
    primary = [rec.model_copy(update={'dish': item(menu, rec.dish.id)}) for rec in primary]
    result = build_meal_combinations(req, menu, primary)
    assert all(part.item_id != 'gyoza' for combo in result.combinations for part in combo.additions)
    with pytest.raises(ValueError):
        validate_proposal(original, build_context(req, menu, primary))


def test_real_menu_unknown_allergen_information_excludes_every_combo():
    req = request(profile={'axes': {'spice': .6, 'richness': .9}, 'allergies': {'allergens': ['peanut']}})
    session = recommend_module.recommend(req)
    assert session.recommendations == [] and session.meal_combinations.combinations == []


@pytest.mark.parametrize('change', ['missing_category', 'unknown_category', 'no_traits', 'duplicate_identity', 'category_mismatch'])
def test_incomplete_or_ambiguous_menu_does_not_invent_accompaniments(change):
    req, menu, primary = setup()
    side = item(menu, 'gyoza')
    category = next(c for c in menu.categories if c.id == side.category_id)
    if change == 'missing_category': menu.categories.remove(category)
    if change == 'unknown_category': category.name = 'Unclassified'
    if change == 'no_traits':
        side.sensory = type(side.sensory)()
        side.ingredients = []
        side.features.textures = []
        side.features.cooking_methods = []
    if change == 'duplicate_identity': category.items.append(deepcopy(side))
    if change == 'category_mismatch': side.category_id = 'different-category'
    result = build_meal_combinations(req, menu, primary)
    assert all(part.item_id != 'gyoza' for combo in result.combinations for part in combo.additions)


def test_negative_feedback_and_listed_dislikes_exclude_additions_without_affecting_picks():
    for update in [{'taste_evidence': {'disliked_ingredients': ['mushrooms']}},
                   {'bridge_feedback': [{'id': 'negative', 'restaurant_id': 'sora-kitchen', 'dish_id': 'gyoza', 'menu_version': get_menu('sora-kitchen').version, 'liked': False, 'date': '2026-10-20T12:00:00Z'}]}]:
        req, menu, primary = setup()
        if 'taste_evidence' in update:
            # Test an explicit listed disliked ingredient, not guessed prose.
            item(menu, 'gyoza').ingredients = ['Mushrooms']
        changed = RecommendationRequest.model_validate({**req.model_dump(), **update})
        before = deepcopy(primary)
        assert all(part.item_id != 'gyoza' for combo in build_meal_combinations(changed, menu, primary).combinations for part in combo.additions)
        assert primary == before


@pytest.mark.parametrize('attack', ['restaurant', 'version', 'nonexistent', 'non_primary', 'duplicate', 'price', 'fractional_price', 'subtotal', 'currency', 'missing_main', 'uncited', 'unrelated', 'false_relation', 'prose', 'category_only', 'duplicate_claim'])
def test_untrusted_provider_proposals_are_rejected(attack):
    context, proposal = proposed()
    raw = proposal.model_dump()
    if attack == 'restaurant': raw['restaurant_id'] = 'another-branch'
    if attack == 'version': raw['menu_version'] = 'obsolete'
    if attack == 'nonexistent': raw['items'][1]['item_id'] = 'invented-side'
    if attack == 'non_primary': raw['main_dish_id'] = 'gyoza'
    if attack == 'duplicate': raw['items'][1] = raw['items'][0]
    if attack == 'price': raw['items'][1]['amount_minor'] += 1
    if attack == 'fractional_price': raw['items'][1]['amount_minor'] = 1300.5
    if attack == 'subtotal': raw['subtotal_minor'] += 1
    if attack == 'currency': raw['items'][1]['currency'] = 'EUR'
    if attack == 'missing_main': raw['items'][0]['item_id'] = 'tofu-don'
    if attack == 'uncited': raw['claims'][0]['left_fact_id'] = 'invented-fact'
    if attack == 'unrelated': raw['claims'][0]['right_fact_id'] = next(f.id for f in context.facts if f.item_id == 'salmon-don')
    if attack == 'false_relation': raw['claims'][0]['relation'] = 'shared'
    if attack == 'prose': raw['rationale'] = 'You love this allergen-safe dish.'
    if attack == 'category_only': raw['claims'] = [{'left_fact_id': next(f.id for f in context.facts if f.item_id == raw['main_dish_id'] and f.attribute == 'category'),
        'right_fact_id': next(f.id for f in context.facts if f.item_id == 'gyoza' and f.attribute == 'category'), 'relation': 'different'}]
    if attack == 'duplicate_claim': raw['claims'].append(raw['claims'][0])
    with pytest.raises((ValueError, ValidationError)):
        validate_proposal(raw, context)


def test_stale_context_and_primary_snapshots_are_rejected():
    req, menu, primary = setup()
    req.menu_version = 'obsolete'
    assert build_meal_combinations(req, menu, primary).unavailable_reason == 'invalid_context'
    req.menu_version = menu.version
    primary[0].dish = primary[0].dish.model_copy(update={'description': 'Not the current dish'})
    assert build_meal_combinations(req, menu, primary).unavailable_reason == 'invalid_context'


def test_exact_cent_boundaries_and_multiple_additions_are_validated():
    req, menu, primary = setup(request('saigon-table'))
    item(menu, 'spring-rolls').price = Price(amount_minor=1301)
    context = build_context(req, menu, primary)
    proposal = DemoMealPairingReasoner().propose(context)[0]
    # Ask the provider for another main->side relation using the same trusted context.
    extra = next(d for d in context.addition_ids if d not in [q.item_id for q in proposal.items])
    from dataclasses import replace
    alternative = DemoMealPairingReasoner().propose(replace(context, primary_ids=(proposal.main_dish_id,), addition_ids=(extra,)))[0]
    raw = proposal.model_dump()
    raw['items'].append(alternative.model_dump()['items'][1])
    raw['claims'] += alternative.model_dump()['claims']
    raw['subtotal_minor'] = sum(q['amount_minor'] for q in raw['items'])
    combo = validate_proposal(raw, context)
    assert len(combo.additions) == 2
    assert combo.subtotal_minor == 4701
    assert all(type(part.price_minor) is int for part in [combo.main, *combo.additions])


def test_provider_failure_never_changes_existing_selection_or_tastebridge(monkeypatch):
    req = request()
    before = recommend_module.recommend(req)
    def broken(self, context):
        raise RuntimeError('Provider unavailable')
    monkeypatch.setattr(DemoMealPairingReasoner, 'propose', broken)
    after = recommend_module.recommend(req)
    assert before.recommendations == after.recommendations
    assert before.evaluation == after.evaluation
    assert before.constraints == after.constraints
    assert after.meal_combinations.unavailable_reason == 'provider_unavailable'


def test_invalid_proposals_fail_individually_and_duplicate_meals_are_not_returned():
    req, menu, primary = setup()
    class Mixed:
        name, mode = 'test', 'model'
        def propose(self, context):
            valid = DemoMealPairingReasoner().propose(context)[0]
            return [valid, valid, {'dish': 'made-up'}]
    result = build_meal_combinations(req, menu, primary, Mixed())
    assert result.status == 'limited' and len(result.combinations) == 1
    assert result.mode == 'model'
    assert any('Unsupported' in line for line in result.uncertainties)


def test_provider_cannot_mutate_trusted_context_or_original_inputs():
    req, menu, primary = setup()
    before = deepcopy((req, menu, primary))
    class Mutator:
        name, mode = 'mutator', 'demo'
        def propose(self, context):
            proposal = DemoMealPairingReasoner().propose(context)[0]
            context.menu.categories.clear()
            context.request.constraints.allergies.other = 'mutated'
            context.facts[0].label = 'unsupported'
            return [proposal]
    result = build_meal_combinations(req, menu, primary, Mutator())
    assert len(result.combinations) == 1
    assert (req, menu, primary) == before
    assert 'unsupported' not in result.combinations[0].rationale


def test_api_extension_is_additive_and_preserves_old_request_contract():
    req = request()
    response = client.post('/api/v2/recommendation-sessions', json=req.model_dump(mode='json', exclude={'taste_evidence', 'options', 'bridge_feedback'}))
    assert response.status_code == 200
    body = response.json()
    result = MealCombinationResult.model_validate(body['meal_combinations'])
    assert result.combinations
    assert len(body['recommendations']) <= 3
    assert all('taste_bridge' in rec and 'budget' in rec for rec in body['recommendations'])


def test_unknown_sensory_preferences_never_become_personal_pairing_claims():
    req = request(profile={'axes': {}}, taste_evidence={'favorite_dishes': ['ramen'], 'textures': ['chewy'],
        'liked_ingredients': ['chili', 'fermented']})
    session = recommend_module.recommend(req)
    assert session.meal_combinations.combinations
    combo = next(c for c in session.meal_combinations.combinations if c.main.item_id == 'miso-ramen')
    assert all(fact.source == 'menu_fixture' for fact in combo.evidence)
    assert 'Your saved' not in combo.rationale
    assert all(value is None for value in session.profile.axes.model_dump().values())


@pytest.mark.parametrize('output', [None, 'invented meal', [{}] * 4])
def test_malformed_provider_batches_fail_soft(output):
    req, menu, primary = setup()
    class Malformed:
        name, mode = 'malformed', 'demo'
        def propose(self, context): return output
    before = deepcopy(primary)
    result = build_meal_combinations(req, menu, primary, Malformed())
    assert result.unavailable_reason == 'invalid_proposal' and not result.combinations
    assert primary == before


def test_invalid_provider_metadata_also_fails_soft():
    req, menu, primary = setup()
    class InvalidMetadata:
        name, mode = 'unconfigured', 'unknown-mode'
        def propose(self, context): pytest.fail('Invalid adapter must not run')
    result = build_meal_combinations(req, menu, primary, InvalidMetadata())
    assert result.unavailable_reason == 'provider_unavailable' and not result.combinations
