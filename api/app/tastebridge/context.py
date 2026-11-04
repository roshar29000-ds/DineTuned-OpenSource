"""Build server-owned evidence, never infer traits from food names or feedback prose."""
from dataclasses import dataclass
from datetime import datetime, timezone
from fastapi import HTTPException
from ..schemas import BridgeAnchor, BridgeFact, MenuItem, RecommendationRequest, RestaurantMenu, AXES
from ..services.catalog import get_menu
from ..services.eligibility import effective_constraints, item_eligibility, recommendation_eligible
# Vocabulary only; no ranking functions or scores are used by TasteBridge.
from ..services.recommendation_ranking import FAMILIES, TEXTURES, COOKING, INGREDIENT_TERMS


@dataclass(frozen=True)
class BridgeContext:
    restaurant_id: str
    menu_version: str
    dish_id: str
    dish_name: str
    facts: tuple[BridgeFact, ...]
    anchors: tuple[BridgeAnchor, ...]
    uncertainties: tuple[str, ...]

class ContradictoryEvidence(ValueError):
    pass


def build_context(req: RecommendationRequest, menu: RestaurantMenu, dish: MenuItem) -> BridgeContext:
    if (menu.restaurant.id, menu.version) != (req.restaurant_id, req.menu_version):
        raise ValueError("Bridge menu identity mismatch")
    current = [item for c in menu.categories for item in c.items if item.id == dish.id]
    if len(current) != 1 or current[0] != dish:
        raise ValueError("Bridge dish does not match the menu")
    constraints = effective_constraints(req.constraints, req.profile)
    if not recommendation_eligible(item_eligibility(dish, constraints)):
        raise ValueError("Bridge target fails hard safeguards")
    if any(f.restaurant_id == menu.restaurant.id and f.dish_id == dish.id and not f.liked for f in req.bridge_feedback):
        raise ContradictoryEvidence("Reported negative feedback for this dish prevents an affirmative bridge")

    facts: list[BridgeFact] = []
    anchors: list[BridgeAnchor] = []
    uncertainties = ["Fictional menu evidence and provisional demo reasoning; not a calibrated prediction or an allergy-safety claim."]

    def add(subject, attribute, value, label, source, reference, basis, **identity):
        fact = BridgeFact(id=f"fact-{len(facts)}", subject=subject, attribute=attribute, value=value,
            label=label, source=source, reference=reference, basis=basis, **identity)
        facts.append(fact)
        return fact.id

    def dish_facts(item, source_menu, subject):
        ids = []
        identity = dict(restaurant_id=source_menu.restaurant.id, menu_version=source_menu.version, dish_id=item.id)
        def put(attribute, value, label, path):
            ids.append(add(subject, attribute, value, label, "menu_fixture", path, "curated_demo", **identity))
        for axis in AXES:
            value = getattr(item.sensory, axis)
            if value is not None:
                put(axis, value, axis, f"menu.items.{item.id}.sensory.{axis}")
        if item.features.family:
            put("family", item.features.family, FAMILIES[item.features.family], f"menu.items.{item.id}.features.family")
        for attribute, values, labels in [("texture", item.features.textures, TEXTURES), ("cooking", item.features.cooking_methods, COOKING)]:
            for value in sorted(set(values)):
                field = "textures" if attribute == "texture" else "cooking_methods"
                put(attribute, value, labels[value], f"menu.items.{item.id}.features.{field}")
        # Exact listed ingredients only. No extraction from prose, negation guesses,
        # or assumption that a missing ingredient means absence.
        for preference, terms in INGREDIENT_TERMS.items():
            listed = [value for value in item.ingredients if value.strip().casefold() in terms]
            if listed:
                put("ingredient", preference, ", ".join(listed), f"menu.items.{item.id}.ingredients")
        return ids

    dish_facts(dish, menu, "target")
    if any(f.attribute == "ingredient" and f.value in req.taste_evidence.disliked_ingredients for f in facts):
        raise ContradictoryEvidence("The listed dish ingredients conflict with a saved dislike")
    user_ids = []
    for axis in AXES:
        value = getattr(req.profile.axes, axis)
        if value is not None:
            user_ids.append(add("user", axis, value, axis, "taste_dna", f"profile.axes.{axis}",
                "inferred" if axis in req.taste_evidence.inferred_axes else "stated"))
    notes = req.taste_evidence
    for attribute, values, labels, path in [
        ("family", notes.favorite_dishes, FAMILIES, "favorite_dishes"),
        ("texture", notes.textures, TEXTURES, "textures"),
        ("cooking", notes.cooking_methods, COOKING, "cooking_methods"),
        ("ingredient", set(notes.liked_ingredients) - set(notes.disliked_ingredients), {}, "liked_ingredients"),
    ]:
        for value in sorted(set(values)):
            user_ids.append(add("user", attribute, value, labels.get(value, value), "taste_detective", f"taste_evidence.{path}", "stated"))
    if user_ids:
        anchors.append(BridgeAnchor(id="saved-taste", kind="saved_preferences", label="Your saved taste preferences", evidence_ids=user_ids))
    if set(notes.liked_ingredients) & set(notes.disliked_ingredients):
        uncertainties.append("Conflicting ingredient likes/dislikes were not used as positive preference evidence.")
    if req.profile.favorites:
        uncertainties.append("Free-text favorites are not interpreted by this provisional reasoner.")
    if any(f.basis == "inferred" for f in facts):
        uncertainties.append("Some Taste DNA dimensions are tentative inferences from saved answers.")

    # Contradictory ratings never become an unqualified 'you liked' anchor.
    groups = {}
    for feedback in req.bridge_feedback:
        groups.setdefault((feedback.restaurant_id, feedback.dish_id), []).append(feedback)
    for key, records in sorted(groups.items()):
        if any(not record.liked for record in records):
            if any(record.liked for record in records):
                uncertainties.append("A dish with conflicting feedback was omitted as a familiar anchor.")
            continue
        feedback = max(records, key=lambda r: (r.date.replace(tzinfo=r.date.tzinfo or timezone.utc), r.id))
        if feedback.date.replace(tzinfo=feedback.date.tzinfo or timezone.utc) > datetime.now(timezone.utc):
            uncertainties.append("Future-dated feedback was omitted.")
            continue
        try:
            previous_menu = get_menu(key[0])
        except HTTPException:
            uncertainties.append("Feedback for an unavailable restaurant could not establish a familiar dish.")
            continue
        previous = [d for c in previous_menu.categories for d in c.items if d.id == key[1]]
        if len(previous) != 1 or previous[0].name == dish.name:
            continue
        if feedback.menu_version != previous_menu.version:
            uncertainties.append("Older feedback has no matching menu snapshot; its historical dish characteristics were not assumed.")
            continue
        familiar = previous[0]
        if not recommendation_eligible(item_eligibility(familiar, constraints)):
            uncertainties.append("A historical dish conflicting with current safeguards was not used as an anchor.")
            continue
        liked_id = add("familiar_dish", "liked", "liked", familiar.name, "reported_feedback", "feedback.liked", "reported",
            restaurant_id=previous_menu.restaurant.id, menu_version=previous_menu.version, dish_id=familiar.id, feedback_id=feedback.id)
        ids = [liked_id, *dish_facts(familiar, previous_menu, "familiar_dish")]
        anchors.append(BridgeAnchor(id=f"memory-{len(anchors)}", kind="liked_dish",
            label=f"{familiar.name} at {previous_menu.restaurant.name}", evidence_ids=ids))
    return BridgeContext(menu.restaurant.id, menu.version, dish.id, dish.name, tuple(facts), tuple(anchors), tuple(dict.fromkeys(uncertainties)))
