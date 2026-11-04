import itertools
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas import DiningConstraints, MenuItem, Price, TasteAxes, TasteProfile
from app.services.catalog import get_menu
from app.services.eligibility import item_eligibility
from app.recommend import explain

client = TestClient(app)
MENU = get_menu("saigon-table")


def request(budget=3000, diets=None, allergies=None, restaurant="saigon-table", profile=None):
    menu = get_menu(restaurant)
    return {
        "restaurant_id": restaurant,
        "menu_version": menu.version,
        "constraints": {"max_price_minor": budget, "dietary_restrictions": diets or [],
                        "allergies": allergies or {"allergens": [], "other": ""}},
        "profile": profile if profile is not None else {"axes": {"spice": .18, "richness": .7, "freshness": .5, "crunch": .8}},
    }


def session(**kwargs):
    response = client.post("/api/v2/recommendation-sessions", json=request(**kwargs))
    assert response.status_code == 200, response.text
    return response.json()


def test_health_truthful_even_with_key(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-not-real")
    health = client.get("/api/health").json()
    assert health["demo_mode"] is True
    assert health["live_meta_inference"] is False
    assert client.post("/api/model/ask", json={"question": "hi"}).status_code == 404


def test_search_is_explicit_and_nearby_sort_is_opt_in():
    results = client.get("/api/v2/restaurants?q=Saigon%20Table").json()
    assert len(results["restaurants"]) == 2
    assert results["location_applied"] is False
    assert all(r["distance_km"] is None and r["is_demo"] for r in results["restaurants"])
    nearby = client.get("/api/v2/restaurants?q=Saigon&latitude=41.895&longitude=-87.635").json()
    assert nearby["location_applied"] is True
    assert nearby["restaurants"][0]["id"] == "saigon-table-river-north"
    assert client.get("/api/v2/restaurants?q=does-not-exist").json()["restaurants"] == []
    assert client.get("/api/v2/restaurants?latitude=41").status_code == 422
    assert client.get("/api/v2/restaurants?latitude=999&longitude=0").status_code == 422


def test_complete_categorized_menu_is_not_truncated_to_recommendations():
    data = client.get("/api/v2/restaurants/saigon-table/menu").json()
    assert data["total_items"] == 20
    assert sum(len(category["items"]) for category in data["categories"]) == 20
    assert len(data["categories"]) == 7
    assert data["source"]["completeness"] == "complete_fixture"
    assert len({item["id"] for c in data["categories"] for item in c["items"]}) == 20
    assert client.get("/api/v2/restaurants/does-not-exist/menu").status_code == 404


@pytest.mark.parametrize('restaurant_id', ['saigon-table', 'casa-sol', 'luna-trattoria', 'sora-kitchen', 'spice-garden', 'olive-ember'])
def test_six_distinct_demo_menus_have_full_original_categories(restaurant_id):
    menu = get_menu(restaurant_id)
    dishes = [item for category in menu.categories for item in category.items]
    assert len(dishes) == menu.total_items == 20
    assert len(menu.categories) == 7
    assert len({item.id for item in dishes}) == len(dishes)
    assert all(item.name and item.description and item.price.amount_minor is not None and item.price.amount_minor > 0 for item in dishes)
    assert all(item.category_id in {category.id for category in menu.categories} for item in dishes)
    assert menu.source.completeness == 'complete_fixture'


@pytest.mark.parametrize('restaurant_id', ['saigon-table', 'casa-sol', 'luna-trattoria', 'sora-kitchen', 'spice-garden', 'olive-ember'])
def test_demo_picks_are_computed_from_current_palate_not_fixed_cards(restaurant_id):
    profiles = [
        {'axes': {'spice': .2, 'freshness': .9, 'crunch': .8}},
        {'axes': {'spice': .9, 'richness': .9, 'umami': .9}},
    ]
    menu_ids = {item.id for category in get_menu(restaurant_id).categories for item in category.items}
    results = [session(restaurant=restaurant_id, profile=profile) for profile in profiles]
    for result in results:
        assert len(result['recommendations']) <= 3
        assert {rec['dish']['id'] for rec in result['recommendations']} <= menu_ids
    assert [rec['dish']['id'] for rec in results[0]['recommendations']] != [rec['dish']['id'] for rec in results[1]['recommendations']]


@pytest.mark.parametrize("budget", [0, 1099, 1100, 1299, 1300, 1301, 1599, 1600, 1799, 1800, 1899, 1900, 2200, 3000])
def test_budget_boundaries_and_distinct_picks(budget):
    data = session(budget=budget)
    assert len(data["recommendations"]) <= 3
    ids = [r["dish"]["id"] for r in data["recommendations"]]
    assert len(ids) == len(set(ids))
    # The original strict boundary assertion belongs to the unchanged menu layer.
    prices = {item.id: item.price.amount_minor for category in MENU.categories for item in category.items}
    assert {item['item_id'] for item in data['evaluation']['items'] if item['eligible']} == {key for key, price in prices.items() if price <= budget}
    assert all(r['budget']['overage_minor'] == max(0, r['dish']['price']['amount_minor'] - budget) for r in data['recommendations'])
    assert all(r['budget']['status'] == ('above_target' if r['dish']['price']['amount_minor'] > budget else 'within_target') for r in data['recommendations'])
    assert ids, "Known taste evidence must produce qualified picks even when all are above budget"
    assert data['recommendations'][0]['category'] == 'Best match'


@pytest.mark.parametrize("diets", [
    ["no_beef", "no_pork"], ["vegetarian", "no_beef", "no_pork"],
    ["vegan", "dairy_free"], ["pescatarian", "no_pork"], ["vegetarian", "gluten_free"],
])
def test_combined_dietary_constraints_are_all_required(diets):
    data = session(diets=diets)
    for recommendation in data["recommendations"]:
        evidence = {item["restriction"]: item["status"] for item in recommendation["dish"]["dietary"]}
        assert all(evidence[restriction] == "supported" for restriction in diets)
    if "gluten_free" in diets:
        assert data["recommendations"] == []
        assert any(reason["code"] == "diet_unknown" for item in data["evaluation"]["items"] for reason in item["reasons"])


def test_strict_menu_evaluation_is_preserved_alongside_soft_recommendation_candidates():
    payload = request(budget=1900, diets=["vegetarian", "no_pork"])
    result = client.post("/api/v2/menu/evaluate", json={k: v for k, v in payload.items() if k != "profile"})
    evaluation = result.json()
    picks = client.post("/api/v2/recommendation-sessions", json=payload).json()
    assert evaluation == picks["evaluation"]
    assert evaluation["total_count"] == 20
    eligible = {item["item_id"] for item in evaluation["items"] if item["eligible"]}
    permitted = {item['item_id'] for item in evaluation['items'] if not any(reason['code'] != 'budget' for reason in item['reasons'])}
    assert all(rec["dish"]["id"] in permitted for rec in picks["recommendations"])
    assert evaluation["eligible_count"] == len(eligible)
    assert evaluation['recommendation_candidate_count'] == len(permitted)


@pytest.mark.parametrize("allergies", [
    {"allergens": ["peanut"], "other": ""},
    {"allergens": ["milk", "wheat", "soy"], "other": ""},
    {"allergens": [], "other": "kiwi"},
])
def test_allergy_unknowns_never_become_safe_recommendations(allergies):
    data = session(allergies=allergies)
    assert data["recommendations"] == []
    assert all(any(r["code"] == "allergen_unknown" for r in item["reasons"]) for item in data["evaluation"]["items"])
    assert data["evaluation"]["total_count"] == 20


def test_saved_allergies_cannot_be_accidentally_dropped_by_session():
    data = session(profile={"allergies": {"allergens": ["peanut"]}})
    assert data["recommendations"] == []
    assert data["constraints"]["allergies"]["allergens"] == ["peanut"]


def test_known_allergen_conflicts_and_unknowns_are_distinct():
    data = session(allergies={"allergens": ["peanut"], "other": ""})
    rolls = next(item for item in data["evaluation"]["items"] if item["item_id"] == "spring-rolls")
    assert {reason["code"] for reason in rolls["reasons"]} == {"allergen_conflict", "allergen_unknown"}


@pytest.mark.parametrize("change", [
    {"constraints": {"max_price_minor": -1}}, {"constraints": {"max_price_minor": 1800.5}},
    {"constraints": {"max_price_minor": "1800"}}, {"constraints": {"currency": "EUR"}},
    {"constraints": {"dietary_restrictions": ["made_up"]}}, {"constraints": {"allergies": {"allergens": ["made_up"]}}},
    {"profile": {"axes": {"spice": 100}}}, {"profile": {"axes": {"spice": -0.1}}},
    {"profile": {"axes": {"heat": 0.5}}}, {"profile": {"exploration": 1.1}},
    {"dietary_restrictions": ["vegetarian"]}, {"allergies": ["peanut"]},
])
def test_invalid_or_unsupported_fields_are_rejected(change):
    payload = {**request(), **change}
    assert client.post("/api/v2/recommendation-sessions", json=payload).status_code == 422


def test_stale_menu_requires_review_and_unknown_restaurant_never_falls_back():
    payload = {**request(), "menu_version": "old-menu"}
    assert client.post("/api/v2/recommendation-sessions", json=payload).status_code == 409
    payload["restaurant_id"] = "not-a-restaurant"
    assert client.post("/api/v2/recommendation-sessions", json=payload).status_code == 404


def test_unknown_price_is_not_eligible_and_money_is_integer():
    item = MENU.categories[0].items[0].model_copy(deep=True)
    item.price = Price(amount_minor=None, status="unknown")
    assert "price_unknown" in {r.code for r in item_eligibility(item, DiningConstraints()).reasons}
    with pytest.raises(ValidationError):
        Price(amount_minor=None, status="listed")
    with pytest.raises(ValidationError):
        Price(amount_minor=18.5)


def test_unknown_and_nonfinite_taste_values():
    assert TasteProfile().axes.spice is None
    with pytest.raises(ValidationError):
        TasteAxes(spice=float("nan"))
    with pytest.raises(ValidationError):
        TasteAxes(spice=float("inf"))


def test_explicit_answers_win_over_negated_free_text():
    response = client.post("/api/v2/taste/profile", json={
        "favorites": "I dislike spicy food and avoid sweet sauces",
        "style": "balanced", "heat": "mild", "texture": "both",
    })
    assert response.status_code == 200
    assert response.json()["axes"]["spice"] == .18
    assert response.json()["axes"]["sweetness"] is None
    assert response.json()["exploration"] == .5
    assert response.json()["source"] == "guided_demo"
    assert client.post("/api/v2/taste/profile", json={"favorites": "  ", "style": "balanced", "heat": "mild", "texture": "both"}).status_code == 422


def test_explanation_describes_low_heat_as_gentle():
    item = next(item for category in MENU.categories for item in category.items if item.id == "spring-rolls")
    why, bridge = explain(item, TasteProfile(axes=TasteAxes(spice=.08)))
    assert "gentle heat" in why
    assert "spicy" not in why and "bold heat" not in why
    assert bridge.evidence
    assert "not a validated" in bridge.uncertainty


def test_exploration_changes_discovery_choice_for_at_least_one_profile():
    changed = False
    for values in itertools.product([.1, .5, .9], repeat=2):
        axes = {"spice": values[0], "richness": values[1], "crunch": .5}
        low = session(profile={"axes": axes, "exploration": 0})
        high = session(profile={"axes": axes, "exploration": 1})
        if low['recommendations'] and high['recommendations'] and [r['dish']['id'] for r in low['recommendations']] != [r['dish']['id'] for r in high['recommendations']]:
            changed = True
            break
    assert changed, "Exploration must have an observable effect"


def test_all_images_are_intentional_local_placeholders_and_pork_is_explicit():
    results = client.get("/api/v2/restaurants").json()
    for restaurant in results["restaurants"]:
        menu = client.get("/api/v2/restaurants/"+restaurant["id"]+"/menu").json()
        for category in menu["categories"]:
            for item in category["items"]:
                assert item["media"]["kind"] == "placeholder"
                assert "photograph" in item["media"]["label"]
                assert "url" not in item["media"]
                if item["id"] == "miso-ramen":
                    assert any("Pork" in ingredient for ingredient in item["ingredients"])


def test_generated_contracts_are_current():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([sys.executable, "-B", str(root / "scripts/generate_contracts.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_openapi_documents_responses():
    schema = client.get("/openapi.json").json()
    response = schema["paths"]["/api/v2/recommendation-sessions"]["post"]["responses"]["200"]
    assert response["content"]["application/json"]["schema"]["$ref"].endswith("/RecommendationSession")
    assert schema["components"]["schemas"]["DiningConstraints"]["additionalProperties"] is False


def test_nonfinite_wire_input_returns_422_without_echoing_it():
    payload = request(profile={"axes": {"spice": float("nan")}})
    response = client.post("/api/v2/recommendation-sessions", content=json.dumps(payload), headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "input" not in response.json()["detail"][0]


def test_conflicting_long_allergy_notes_do_not_produce_an_invalid_response():
    payload = request(allergies={"allergens": [], "other": "a" * 150}, profile={"allergies": {"other": "b" * 150}})
    response = client.post("/api/v2/recommendation-sessions", json=payload)
    assert response.status_code == 422
    assert "allergy notes" in response.json()["detail"]
