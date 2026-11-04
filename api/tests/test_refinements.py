import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.schemas import AllergyProfile, DiningConstraints, RefinementRequest, RecommendationRequest, TasteAxes, TasteProfile
from app.services.catalog import get_menu
from app.services.recommendation_ranking import rank_dish
from test_signature_picks import dish, engine, setup


def actual(restaurant='saigon-table', budget=3000, **kwargs):
    menu = get_menu(restaurant)
    return RecommendationRequest(restaurant_id=restaurant, menu_version=menu.version,
        constraints=DiningConstraints(max_price_minor=budget),
        profile=TasteProfile(complete=True, axes=TasteAxes(spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8)), **kwargs)


def ids(session):
    return [rec.dish.id for rec in session.recommendations]


@pytest.mark.parametrize('restaurant,preference,expected', [
    ('saigon-table', 'lighter', ['banh-mi', 'spring-rolls', 'lemongrass']),
    ('saigon-table', 'spicier', ['bun-bo', 'lemongrass', 'banh-mi']),
    ('saigon-table', 'adventurous', ['bun-bo', 'banh-mi', 'tofu-bun']),
    ('casa-sol', 'less_creamy', ['mushroom-taco', 'chicken-tinga', 'birria']),
])
def test_real_menu_refinements_change_selection_without_changing_dna(restaurant, preference, expected):
    req = actual(restaurant)
    original = engine.recommend(req)
    before = req.model_dump()
    updated = engine.recommend(req.model_copy(update={'refinements': RefinementRequest(preferences=[preference])}))
    assert ids(updated) == expected and ids(updated) != ids(original)
    assert updated.refinement_result.status == 'applied'
    assert req.model_dump() == before
    assert updated.profile == original.profile
    for rec in updated.recommendations:
        match = rank_dish(rec.dish, req)
        assert match.qualified
        assert rec.compatibility.score == match.score  # No second taste-scoring system.
    reset = engine.recommend(req)
    assert reset.recommendations == original.recommendations
    assert reset.meal_combinations == original.meal_combinations
    assert reset.worth_the_stretch == original.worth_the_stretch


def test_unknown_creaminess_and_heat_never_become_positive_claims(monkeypatch):
    req = actual(refinements=RefinementRequest(preferences=['less_creamy']))
    response = engine.recommend(req)
    assert response.refinement_result.status == 'unchanged'
    assert all('does not establish' in ' '.join(rec.compatibility.uncertainties) for rec in response.recommendations)
    unknown = dish('unknown')
    unknown.sensory.spice = None
    req, _ = setup(monkeypatch, [unknown], refinements=RefinementRequest(preferences=['spicier']))
    rec = engine.recommend(req).recommendations[0]
    assert 'Heat is undocumented' in ' '.join(rec.compatibility.uncertainties)
    assert not any(e.kind == 'session' for e in rec.compatibility.evidence)


def test_try_another_returns_only_unseen_strong_dishes_and_exhaustion_is_honest():
    req = actual()
    first = engine.recommend(req)
    req.refinements = RefinementRequest(avoid_dish_ids=ids(first))
    second = engine.recommend(req)
    assert ids(second) and not set(ids(first)).intersection(ids(second))
    assert all(rank_dish(rec.dish, req).qualified for rec in second.recommendations)
    req.refinements = RefinementRequest(avoid_dish_ids=ids(first) + ids(second))
    exhausted = engine.recommend(req)
    assert not exhausted.recommendations and not exhausted.worth_the_stretch.picks
    assert exhausted.empty_reason == 'no_alternatives'
    assert exhausted.refinement_result.status == 'no_alternatives'
    assert 'Reset' in exhausted.message
    req.refinements = RefinementRequest()
    assert engine.recommend(req).recommendations == first.recommendations


@pytest.mark.parametrize('preference', ['lighter', 'less_creamy', 'spicier', 'adventurous'])
def test_refinements_cannot_rescue_poor_taste_or_relax_hard_safety(monkeypatch, preference):
    weak = dish('weak', 100, .95)
    weak.portion, weak.novelty = 'light', 1.
    unsafe = dish('unavailable', 100)
    unsafe.available = False
    req, _ = setup(monkeypatch, [weak, unsafe], refinements=RefinementRequest(preferences=[preference]))
    assert not engine.recommend(req).recommendations
    req = actual(refinements=RefinementRequest(preferences=[preference]))
    req.constraints.allergies = AllergyProfile(allergens=['peanut'])
    result = engine.recommend(req)
    assert result.empty_reason == 'hard_exclusions'
    assert not result.recommendations and not result.worth_the_stretch.picks
    assert not result.meal_combinations.combinations


@pytest.mark.parametrize('budget', [0, 1899, 3000])
def test_combined_preferences_preserve_budget_tiers_exact_prices_and_related_identity(budget):
    req = actual(budget=budget, refinements=RefinementRequest(preferences=['lighter', 'spicier', 'adventurous']))
    menu = get_menu(req.restaurant_id)
    response = engine.recommend(req)
    picks, extra = response.recommendations, response.worth_the_stretch.picks
    primary_ids = set(ids(response))
    assert not primary_ids.intersection(rec.dish.id for rec in extra)
    assert len(picks) <= 3 and len(extra) <= 2
    assert [rec.budget.status == 'above_target' for rec in picks] == sorted(rec.budget.status == 'above_target' for rec in picks)
    eligible_in_budget = {d.id for c in menu.categories for d in c.items if d.price.amount_minor <= budget and rank_dish(d, req).qualified}
    assert len(eligible_in_budget & primary_ids) == min(3, len(eligible_in_budget))
    for rec in [*picks, *extra]:
        assert rec.budget.overage_minor == max(0, rec.dish.price.amount_minor - budget)
        assert (rec.taste_bridge.restaurant_id, rec.taste_bridge.menu_version, rec.taste_bridge.dish_id) == (menu.restaurant.id, menu.version, rec.dish.id)
    for combo in response.meal_combinations.combinations:
        assert combo.main.item_id in primary_ids
        assert combo.subtotal_minor == combo.main.price_minor + sum(part.price_minor for part in combo.additions)
    req.options.include_over_budget = False
    hidden = engine.recommend(req)
    assert not hidden.worth_the_stretch.picks
    assert all(rec.budget.overage_minor == 0 for rec in hidden.recommendations)


def test_set_aside_items_cannot_return_as_pairing_additions_or_stretch():
    req = actual(budget=1800, refinements=RefinementRequest(preferences=['spicier'], avoid_dish_ids=['spring-rolls', 'lemongrass']))
    response = engine.recommend(req)
    seen = {rec.dish.id for rec in [*response.recommendations, *response.worth_the_stretch.picks]}
    seen.update(part.item_id for combo in response.meal_combinations.combinations for part in [combo.main, *combo.additions])
    assert not seen.intersection(req.refinements.avoid_dish_ids)


def test_combined_diets_and_saved_allergies_remain_hard_safeguards():
    req = actual(refinements=RefinementRequest(preferences=['lighter', 'spicier']))
    req.constraints = DiningConstraints(max_price_minor=3000, dietary_restrictions=['vegetarian', 'dairy_free'])
    assert ids(engine.recommend(req)) == ['tofu-bun']
    req.profile.allergies = AllergyProfile(allergens=['peanut'])
    assert not engine.recommend(req).recommendations


def test_unknown_profile_is_not_filled_in_by_refinement_preferences():
    req = actual(refinements=RefinementRequest(preferences=['lighter', 'spicier', 'adventurous']))
    req.profile = TasteProfile()
    result = engine.recommend(req)
    assert result.empty_reason == 'insufficient_evidence'
    assert not result.recommendations


def test_invalid_refinements_fail_validation_and_stale_menu_is_not_reused():
    for invalid in [{'preferences': ['magic']}, {'preferences': ['lighter', 'lighter']},
                    {'avoid_dish_ids': ['pho', 'pho']}, {'avoid_dish_ids': [f'id-{i}' for i in range(51)]}, {'unknown': True}]:
        with pytest.raises(ValidationError): RefinementRequest(**invalid)
    req = actual(refinements=RefinementRequest(avoid_dish_ids=['foreign-dish']))
    with pytest.raises(HTTPException) as error: engine.recommend(req)
    assert error.value.status_code == 422
    req.menu_version = 'stale-menu'
    with pytest.raises(HTTPException) as error: engine.recommend(req)
    assert error.value.status_code == 409
