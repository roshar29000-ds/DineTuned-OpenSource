"""Single server-owned fixture catalog; no restaurant/ranking fixtures in the UI."""
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from .schemas import (
    AllergenEvidence, DietaryEvidence, DietaryRestriction, MediaAsset, MenuCategory,
    MenuItem, Price, RestaurantMenu, RestaurantSummary,
)

CATALOG_PATH = Path(__file__).parent / "data" / "catalog.json"
ADDITIONS_PATH = Path(__file__).parent / "data" / "catalog_additions.json"
CATEGORY_DESCRIPTIONS = {
    "Small plates": "Little beginnings. A few bites, plenty of character.",
    "Noodles & soups": "Slow-simmered comfort, bright herbs, and beautiful broths.",
    "Rice & bowls": "Generous bowls with a little of everything you love.",
    "Tacos": "Warm tortillas, bold fillings, and a squeeze of lime.",
    "Pasta": "Comfort, with a little Italian soul.",
    "Curries": "Layers of spice, warmth, and slow-cooked flavor.",
    "Grilled plates": "Char from the grill, bright herbs and complete plates.",
    "Sides": "Small additions to finish the table.",
    "Desserts": "A thoughtful final bite.",
    "Beverages": "Something refreshing alongside the meal.",
    "Plates": "Generous plates with bold, balanced flavors.",
    "Bowls": "Colorful combinations served together.",
    "Pizza": "Thin crusts and carefully chosen toppings.",
    "Mains": "The center of the table.",
    "Noodles": "Broths and noodles for every appetite.",
    "Rice bowls": "Rice, vegetables and satisfying toppings.",
    "Robata": "Skewers from the grill.",
    "Sushi & raw": "Fresh, carefully prepared bites.",
    "Tandoor": "Warm spice and the heat of the oven.",
    "Rice": "Fragrant basmati and layered plates.",
    "Breads & sides": "A little something alongside the main.",
    "Mezze": "Little dishes made for sharing.",
    "From the fire": "Charred and grilled plates.",
    "Salads & bowls": "Bright vegetables and satisfying grains.",
}

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")

def dietary_evidence(dish: dict) -> list[DietaryEvidence]:
    """Fixture annotations. Absence of an allergen never establishes safety."""
    contains = dish["allergens"]
    supported = {
        "vegetarian": dish["vegetarian"],
        "vegan": dish["vegan"],
        "pescatarian": dish["protein"] in ("none", "seafood"),
        "no_beef": dish["protein"] != "beef",
        "no_pork": dish["protein"] != "pork",
    }
    result = [DietaryEvidence(restriction=DietaryRestriction(key), status="supported" if value else "conflict") for key, value in supported.items()]
    result.extend([
        DietaryEvidence(restriction=DietaryRestriction.dairy_free, status="conflict" if "milk" in contains else "supported" if dish["vegan"] else "unknown"),
        DietaryEvidence(restriction=DietaryRestriction.gluten_free, status="conflict" if "wheat" in contains else "unknown"),
    ])
    return result

@lru_cache(maxsize=1)
def catalog() -> dict[str, tuple[RestaurantMenu, tuple[float, float]]]:
    raw = CATALOG_PATH.read_bytes()
    additions_raw = ADDITIONS_PATH.read_bytes()
    version = "demo-" + hashlib.sha256(raw + additions_raw).hexdigest()[:12]
    records = json.loads(raw)
    additions = json.loads(additions_raw)
    records.append(additions["restaurant"])
    for record in records:
        for row in additions["menus"].get(record["id"], []):
            identifier, name, description, price, category, ingredients, protein, allergens, traits = row
            ordered_flags = traits.split(',')
            flags = set(ordered_flags)
            known_allergens = [value for value in allergens.split(',') if value]
            values = {"spice": None, "richness": None, "freshness": None, "crunch": None,
                      "aromatic": None, "sweetness": None, "umami": None}
            for flag, axis, score in (("spicy", "spice", .82), ("mild", "spice", .18),
                                      ("rich", "richness", .82), ("light", "richness", .27),
                                      ("fresh", "freshness", .86), ("crisp", "crunch", .85),
                                      ("soft", "crunch", .22), ("aromatic", "aromatic", .82),
                                      ("sweet", "sweetness", .78), ("savory", "umami", .82)):
                if flag in flags: values[axis] = score
            record["menu"].append({"id": identifier, "name": name, "description": description,
                "price_minor": price, "category": category, "ingredients": [v for v in ingredients.split(',') if v],
                "protein": protein, "allergens": known_allergens, "vegetarian": protein == "none",
                "vegan": protein == "none" and not set(known_allergens) & {"milk", "egg", "fish", "shellfish"},
                "labels": [v.title() for v in ordered_flags if v in {"spicy", "mild", "rich", "light", "fresh", "crisp", "aromatic", "sweet", "savory"}][:3],
                "motif": {"Vietnamese": "bowl", "Mexican": "tacos", "Italian": "pasta", "Japanese": "bowl", "Indian": "curry", "Mediterranean": "plate"}[record["cuisine"]],
                "sensory": values, "novelty": .82 if "adventurous" in flags else .38 if "familiar" in flags else .62,
                "features": {"family": None, "textures": ["crisp"] if "crisp" in flags else [],
                             "cooking_methods": [v for v in ("grilled", "roasted", "fried", "braised") if v in flags]}})
    # An explicit second sample location makes name + nearby ordering testable.
    records.append({**records[0], "id": "saigon-table-river-north", "area": "River North", "latitude": 41.895, "longitude": -87.635})
    result = {}
    for record in records:
        categories: dict[str, MenuCategory] = {}
        for dish in record["menu"]:
            category_id = slug(dish["category"])
            if category_id not in categories:
                categories[category_id] = MenuCategory(id=category_id, name=dish["category"], description=CATEGORY_DESCRIPTIONS.get(dish["category"], "Good ingredients. Thoughtful combinations."), items=[])
            categories[category_id].items.append(MenuItem(
                id=dish["id"], category_id=category_id, name=dish["name"], description=dish["description"],
                price=Price(amount_minor=dish["price_minor"]), ingredients=dish["ingredients"], labels=dish["labels"],
                dietary=dietary_evidence(dish), allergens=AllergenEvidence(contains=dish["allergens"], information_status="partial"),
                media=MediaAsset(motif=dish["motif"], accent=record["accent"]), sensory=dish["sensory"],
                novelty=dish["novelty"], portion="light" if dish["category"] in {"Small plates", "Mezze", "Sides", "Breads & sides", "Desserts", "Beverages"} else "hearty",
                features={**dish.get("features", {}), "protein": "plant_forward" if dish["protein"] == "none" else dish["protein"]},
            ))
        restaurant = RestaurantSummary(
            **{key: record[key] for key in ("id", "name", "cuisine", "area", "subtitle", "price_label", "accent")},
            item_count=len(record["menu"]),
        )
        result[restaurant.id] = (RestaurantMenu(version=version, restaurant=restaurant, categories=list(categories.values()), total_items=restaurant.item_count), (record["latitude"], record["longitude"]))
    return result
