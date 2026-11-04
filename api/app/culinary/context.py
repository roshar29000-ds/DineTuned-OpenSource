from collections import Counter
from dataclasses import dataclass, replace
from hashlib import sha256
import json
from pydantic import ValidationError
from ..schemas import RecommendationRequest, RestaurantMenu
from ..services.eligibility import effective_constraints, item_eligibility, recommendation_eligible
from ..tastebridge.context import BridgeContext, build_context as build_bridge_context
from .errors import CulinaryError


@dataclass(frozen=True)
class CulinaryContext:
    request: RecommendationRequest
    menu: RestaurantMenu
    bridges: dict[str, BridgeContext]

    @property
    def has_candidates(self) -> bool:
        return bool(self.bridges)

    def wire(self) -> dict:
        items = []
        for category in self.menu.categories:
            for dish in category.items:
                bridge = self.bridges.get(dish.id)
                if bridge is None:
                    continue
                items.append({"id": dish.id, "name": dish.name, "category_id": category.id, "category": category.name,
                    "price": dish.price.model_dump(), "description": dish.description, "ingredients": dish.ingredients,
                    "dietary": [d.model_dump(mode="json") for d in dish.dietary], "allergens": dish.allergens.model_dump(mode="json"),
                    "portion": dish.portion, "novelty": dish.novelty, "labels": dish.labels,
                    "anchors": [a.model_dump() for a in bridge.anchors],
                    "facts": [f.model_dump(exclude_none=True) for f in bridge.facts]})
        req = self.request
        return {"restaurant_id": self.menu.restaurant.id, "restaurant_name": self.menu.restaurant.name,
            "menu_version": self.menu.version, "menu_source": self.menu.source.model_dump(mode="json"),
            "profile": req.profile.model_dump(mode="json", exclude={"updated_at"}),
            "taste_evidence": req.taste_evidence.model_dump(),
            "confidence_basis": {axis: "unknown" if value is None else "inferred" if axis in req.taste_evidence.inferred_axes else "stated"
                for axis, value in req.profile.axes.model_dump().items()},
            "feedback": [f.model_dump(mode="json", exclude={"id"}) for f in req.bridge_feedback],
            "constraints": req.constraints.model_dump(mode="json"), "options": req.options.model_dump(),
            "refinements": req.refinements.model_dump(), "items": items}

    @property
    def digest(self) -> str:
        return sha256(json.dumps(self.wire(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def build_context(request: RecommendationRequest, menu: RestaurantMenu) -> CulinaryContext:
    try:
        request = RecommendationRequest.model_validate(request.model_dump())
        menu = RestaurantMenu.model_validate(menu.model_dump())
    except ValidationError:
        raise CulinaryError("invalid_context", "The profile or menu no longer satisfies the validated input contract.") from None
    if (request.restaurant_id, request.menu_version) != (menu.restaurant.id, menu.version):
        raise CulinaryError("stale_menu", "The selected menu identity is stale.")
    if menu.total_items > 8 or len(request.bridge_feedback) > 3:
        raise CulinaryError("context_limit", "This developer integration accepts at most eight menu items and three feedback records.")
    req = request.model_copy(update={"constraints": effective_constraints(request.constraints, request.profile)}, deep=True)
    snapshot = menu.model_copy(deep=True)
    counts = Counter(d.id for c in snapshot.categories for d in c.items)
    categories = Counter(c.id for c in snapshot.categories)
    if sum(counts.values()) > 8 or any(counts[i] != 1 for i in req.refinements.avoid_dish_ids):
        raise CulinaryError("invalid_context", "Refinements or menu size could not be verified.")
    bridges = {}
    for category in snapshot.categories:
        for dish in category.items:
            if counts[dish.id] != 1 or categories[category.id] != 1 or dish.category_id != category.id:
                continue
            if dish.id in req.refinements.avoid_dish_ids or not recommendation_eligible(item_eligibility(dish, req.constraints)):
                continue
            if not req.options.include_over_budget and dish.price.amount_minor > req.constraints.max_price_minor:
                continue
            try:
                bridge = build_bridge_context(req, snapshot, dish)
            except ValueError:
                continue  # Includes contradictory explicit dislikes/feedback.
            bridges[dish.id] = replace(bridge, uncertainties=(
                "Fictional menu evidence; fit is not a calibrated probability or an allergy-safety claim.", *bridge.uncertainties[1:]))
    return CulinaryContext(req, snapshot, bridges)
