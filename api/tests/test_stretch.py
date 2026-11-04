"""Worth the Stretch shares primary quality/safety; only its placement is new."""
import pytest
from fastapi import HTTPException
from app.schemas import DiningConstraints, Price, RecommendationOptions, RecommendationRequest, TasteAxes, TasteProfile
from app.services.catalog import get_menu
from app.services.recommendation_ranking import rank_dish
from test_signature_picks import dish, engine, setup


@pytest.mark.parametrize('count', range(7))
def test_zero_to_two_distinct_extras_without_changing_primary_selection(monkeypatch, count):
    req, _ = setup(monkeypatch, [dish(f'good-{i}', 1900) for i in range(count)] + [dish('weak', 2200, .95)])
    result = engine.recommend(req)
    assert [rec.dish.id for rec in result.recommendations] == [f'good-{i}' for i in range(min(3, count))]
    extra = result.worth_the_stretch.picks
    assert [rec.dish.id for rec in extra] == [f'good-{i}' for i in range(3, min(5, count))]
    assert all(rec.compatibility == rank_dish(rec.dish, req).compatibility for rec in extra)
    assert all(rec.budget.overage_minor == 100 for rec in extra)


@pytest.mark.parametrize('price', [1900, 100000])
def test_exact_overage_no_cap_and_no_within_budget_extras(monkeypatch, price):
    items = [dish(f'within-{i}', 1899) for i in range(4)] + [dish('above', price)]
    req, _ = setup(monkeypatch, items, budget=1899)
    result = engine.recommend(req)
    assert [rec.dish.id for rec in result.worth_the_stretch.picks] == ['above']
    rec = result.worth_the_stretch.picks[0]
    assert rec.budget.overage_minor == price - 1899
    assert rec.budget.status == 'above_target'
    assert rec.budget.target_minor == 1899
    assert rec.dish.price.amount_minor == price
    req.options.include_over_budget = False
    hidden = engine.recommend(req)
    assert hidden.recommendations == result.recommendations
    assert hidden.worth_the_stretch.picks == []


@pytest.mark.parametrize('reason', ['unavailable', 'unknown-price', 'diet', 'unknown-allergen', 'known-allergen', 'duplicate', 'dislike', 'unknown-taste'])
def test_stretch_never_bypasses_hard_safeguards_or_evidence(monkeypatch, reason):
    extra = dish('extra', 2200)
    items = [dish(f'within-{i}') for i in range(3)] + [extra]
    req, menu = setup(monkeypatch, items)
    if reason == 'unavailable': extra.available = False
    if reason == 'unknown-price': extra.price = Price(amount_minor=None, status='unknown')
    if reason == 'diet': req.constraints = DiningConstraints(max_price_minor=1800, dietary_restrictions=['vegetarian', 'no_pork'])
    if reason in ('known-allergen', 'unknown-allergen'):
        req.constraints.allergies.allergens = ['fish' if reason == 'known-allergen' else 'peanut']
        if reason == 'known-allergen':
            extra.allergens.information_status = 'documented'
            extra.allergens.cross_contact = 'documented_controls'
    if reason == 'duplicate': menu.categories[0].items.append(extra.model_copy(deep=True))
    if reason == 'dislike':
        extra.ingredients = ['Garlic']
        req.taste_evidence.disliked_ingredients = ['garlic']
    if reason == 'unknown-taste': req.profile = TasteProfile()
    assert engine.recommend(req).worth_the_stretch.picks == []


@pytest.mark.parametrize('restaurant,expected', [('saigon-table', ['lemongrass', 'bun-bo']), ('casa-sol', ['birria'])])
def test_actual_demo_results_identity_and_primary_pairing_isolation(restaurant, expected):
    menu = get_menu(restaurant)
    req = RecommendationRequest(restaurant_id=restaurant, menu_version=menu.version, constraints=DiningConstraints(max_price_minor=1800),
        profile=TasteProfile(complete=True, axes=TasteAxes(spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8)))
    result = engine.recommend(req)
    extra = result.worth_the_stretch
    assert (extra.restaurant_id, extra.menu_version) == (restaurant, menu.version)
    assert [rec.dish.id for rec in extra.picks] == expected
    primary = {rec.dish.id for rec in result.recommendations}
    assert not primary.intersection(expected)
    for rec in extra.picks:
        assert rec.taste_bridge.dish_id == rec.dish.id
        assert rec.taste_bridge.restaurant_id == restaurant
        assert rec.taste_bridge.menu_version == menu.version
    assert all(combo.main.item_id in primary for combo in result.meal_combinations.combinations)
    assert result.model_dump(exclude={'id', 'created_at'}) == engine.recommend(req).model_dump(exclude={'id', 'created_at'})
    req.menu_version = 'stale-version'
    with pytest.raises(HTTPException) as error: engine.recommend(req)
    assert error.value.status_code == 409


def test_low_budget_cannot_reintroduce_primary_over_budget_dishes(monkeypatch):
    req, _ = setup(monkeypatch, [dish(f'item-{i}', 2000) for i in range(6)], budget=0)
    result = engine.recommend(req)
    assert [rec.dish.id for rec in result.worth_the_stretch.picks] == ['item-3', 'item-4']
    assert all(rec.budget.overage_minor == 2000 for rec in result.worth_the_stretch.picks)
    req.options = RecommendationOptions(include_over_budget=False)
    hidden = engine.recommend(req)
    assert not hidden.recommendations and not hidden.worth_the_stretch.picks
