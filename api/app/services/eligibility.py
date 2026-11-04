"""Hard constraints shared by the full menu and recommendation engine."""
from fastapi import HTTPException
from ..schemas import DiningConstraints, Exclusion, ItemEligibility, MenuEvaluation, MenuItem, RestaurantMenu, TasteProfile

def effective_constraints(constraints: DiningConstraints, profile: TasteProfile) -> DiningConstraints:
    # Never accidentally drop a saved restriction when constructing a session.
    result = constraints.model_copy(deep=True)
    result.dietary_restrictions = list(dict.fromkeys([*profile.dietary_restrictions, *result.dietary_restrictions]))
    result.allergies.allergens = list(dict.fromkeys([*profile.allergies.allergens, *result.allergies.allergens]))
    result.allergies.other = "; ".join(dict.fromkeys(x for x in (profile.allergies.other, result.allergies.other) if x))
    if len(result.allergies.other) > 200:
        raise HTTPException(status_code=422, detail="Saved and current allergy notes differ. Review your allergy notes on the full menu before requesting picks.")
    return result

def item_eligibility(item: MenuItem, constraints: DiningConstraints) -> ItemEligibility:
    reasons: list[Exclusion] = []
    if not item.available:
        reasons.append(Exclusion(code="unavailable", message="Currently unavailable"))
    if item.price.status == "unknown" or item.price.amount_minor is None:
        reasons.append(Exclusion(code="price_unknown", message="Price unavailable; cannot verify your budget"))
    elif item.price.currency != constraints.currency or item.price.amount_minor > constraints.max_price_minor:
        reasons.append(Exclusion(code="budget", message="Above your per-dish budget"))
    reasons.extend(safety_exclusions({e.restriction: e.status for e in item.dietary}, item.allergens, constraints))
    return ItemEligibility(item_id=item.id, eligible=not reasons, reasons=reasons)

def evaluate_menu(menu: RestaurantMenu, constraints: DiningConstraints) -> MenuEvaluation:
    items = [item_eligibility(item, constraints) for category in menu.categories for item in category.items]
    return MenuEvaluation(restaurant_id=menu.restaurant.id, menu_version=menu.version, constraints=constraints, total_count=len(items), eligible_count=sum(x.eligible for x in items), items=items,
        recommendation_candidate_count=sum(recommendation_eligible(item) for item in items))

def recommendation_eligible(result: ItemEligibility) -> bool:
    """Only budget is soft for Picks. Unknown prices, availability, diets and allergies remain hard."""
    return not any(reason.code != "budget" for reason in result.reasons)


def safety_exclusions(dietary: dict, allergen_evidence, constraints: DiningConstraints) -> list[Exclusion]:
    """Shared hard restrictions; missing evidence never implies suitability."""
    reasons: list[Exclusion] = []
    for restriction in dict.fromkeys(constraints.dietary_restrictions):
        status = dietary.get(restriction, "unknown")
        if status != "supported":
            name = restriction.value.replace("_", " ")
            reasons.append(Exclusion(code="diet_conflict" if status == "conflict" else "diet_unknown", message=f"Does not meet {name}" if status == "conflict" else f"{name.capitalize()} information unconfirmed"))
    allergies = constraints.allergies
    if allergies.allergens or allergies.other:
        conflicts = set(allergies.allergens) & set(allergen_evidence.contains + allergen_evidence.may_contain)
        if conflicts:
            names = ", ".join(sorted(a.value.replace("_", " ") for a in conflicts))
            reasons.append(Exclusion(code="allergen_conflict", message=f"Listed or possible allergen: {names}"))
        if allergies.other or allergen_evidence.information_status != "documented" or allergen_evidence.cross_contact != "documented_controls":
            reasons.append(Exclusion(code="allergen_unknown", message="Ingredient or cross-contact information is incomplete; restaurant confirmation needed"))
    return reasons
