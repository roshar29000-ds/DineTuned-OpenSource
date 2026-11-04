"""Build trusted pairing evidence from the selected menu and saved preferences."""
from collections import Counter
from dataclasses import dataclass
from ..schemas import AXES, MenuItem, PairingFact, Recommendation, RecommendationRequest, RestaurantMenu
from ..services.eligibility import effective_constraints, item_eligibility, recommendation_eligible
from ..services.recommendation_ranking import INGREDIENT_TERMS, TEXTURES, COOKING

# Explicit category vocabulary, not inferred roles from dish names. These demo
# menus currently contain only Small plates. Future ingestion must supply verified
# category semantics before extending this mapping.
ADDITION_CATEGORIES = {"small-plates": "Small plates", "sides": "Sides", "drinks": "Drinks", "desserts": "Desserts", "appetizers": "Appetizers"}

@dataclass(frozen=True)
class PairingContext:
    request: RecommendationRequest
    menu: RestaurantMenu
    primary_ids: tuple[str, ...]
    eligible_ids: tuple[str, ...]
    addition_ids: tuple[str, ...]
    facts: tuple[PairingFact, ...]


def build_context(req: RecommendationRequest, menu: RestaurantMenu, primary: list[Recommendation]) -> PairingContext:
    if (req.restaurant_id, req.menu_version) != (menu.restaurant.id, menu.version):
        raise ValueError("Pairing context has stale menu identity")
    constraints = effective_constraints(req.constraints, req.profile)
    req = req.model_copy(update={"constraints": constraints}, deep=True)
    items = [d for category in menu.categories for d in category.items]
    counts = Counter(d.id for d in items)
    categories = Counter(c.id for c in menu.categories)
    reliable = {d.id: d for category in menu.categories for d in category.items
        if counts[d.id] == 1 and categories[category.id] == 1 and d.category_id == category.id}
    if len(primary) > 3 or len({r.dish.id for r in primary}) != len(primary):
        raise ValueError("Ambiguous primary identities")
    for rec in primary:
        if reliable.get(rec.dish.id) != rec.dish:
            raise ValueError("Primary is not the current menu item")

    def suitable(item: MenuItem):
        if item.id in req.refinements.avoid_dish_ids:
            return False  # A set-aside dish must not reappear as an accompaniment.
        if not recommendation_eligible(item_eligibility(item, constraints)):
            return False
        if item.price.currency != constraints.currency or item.price.status != "listed" or type(item.price.amount_minor) is not int:
            return False
        if not req.options.include_over_budget and item.price.amount_minor > constraints.max_price_minor:
            return False
        # Do not interpret free-text feedback or assume an absent ingredient is safe.
        ingredients = {value.strip().casefold() for value in item.ingredients}
        if any(ingredients.intersection(INGREDIENT_TERMS[dislike]) for dislike in req.taste_evidence.disliked_ingredients):
            return False
        return not any(f.restaurant_id == menu.restaurant.id and f.dish_id == item.id and not f.liked for f in req.bridge_feedback)

    eligible = tuple(key for key, dish in reliable.items() if suitable(dish))
    addition_ids = tuple(d.id for c in menu.categories if ADDITION_CATEGORIES.get(c.id) == c.name
        for d in c.items if d.id in eligible)
    facts = []
    def add(item_id, attribute, value, label, source, reference, basis):
        facts.append(PairingFact(id=f"pair-fact-{len(facts)}", item_id=item_id, attribute=attribute, value=value,
            label=label, source=source, reference=reference, basis=basis))
    for category in menu.categories:
        for dish in category.items:
            if dish.id not in eligible:
                continue
            def put(attribute, value, label, path):
                add(dish.id, attribute, value, label, "menu_fixture", path, "curated_demo")
            put("category", category.id, category.name, f"menu.categories.{category.id}.name")
            put("portion", dish.portion, dish.portion, f"menu.items.{dish.id}.portion")
            for axis in AXES:
                if (value := getattr(dish.sensory, axis)) is not None:
                    put(axis, value, axis, f"menu.items.{dish.id}.sensory.{axis}")
            for attribute, values, labels, path in [
                ("texture", dish.features.textures, TEXTURES, "features.textures"),
                ("cooking", dish.features.cooking_methods, COOKING, "features.cooking_methods"),
                ("ingredient", sorted(set(dish.ingredients)), {}, "ingredients"),
            ]:
                for value in values:
                    put(attribute, value.strip().casefold(), labels.get(value, value), f"menu.items.{dish.id}.{path}")
            if dish.features.protein:
                put("protein", dish.features.protein, dish.features.protein.replace('_', ' '), f"menu.items.{dish.id}.features.protein")
    for axis in AXES:
        if (value := getattr(req.profile.axes, axis)) is not None:
            add(None, axis, value, axis, "taste_dna", f"profile.axes.{axis}", "inferred" if axis in req.taste_evidence.inferred_axes else "stated")
    for attribute, values, labels, path in [("texture", req.taste_evidence.textures, TEXTURES, "textures"),
                                          ("cooking", req.taste_evidence.cooking_methods, COOKING, "cooking_methods")]:
        for value in sorted(set(values)):
            add(None, attribute, value, labels[value], "taste_detective", f"taste_evidence.{path}", "stated")
    if req.options.protein_preference != "any":
        add(None, "protein", req.options.protein_preference, req.options.protein_preference.replace('_', ' '), "session", "options.protein_preference", "stated")
    return PairingContext(req, menu, tuple(r.dish.id for r in primary), eligible, addition_ids, tuple(facts))
