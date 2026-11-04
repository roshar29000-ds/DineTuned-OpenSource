"""Small provisional ordering adapter over ALREADY qualified, hard-eligible dishes.

A future culinary provider consumes RefinementRequest at the same boundary.
This demo does not admit new candidates, infer missing attributes, alter Taste DNA,
or decide budget tiers. Those responsibilities stay in the recommendation pipeline.
"""
from dataclasses import replace
from ..schemas import RecommendationEvidence, RefinementRequest, RefinementResult
from .recommendation_ranking import RankedDish, words


def priority(candidate: RankedDish, intent: RefinementRequest) -> float:
    """Equal-weight directional preferences; original taste score breaks ties."""
    dish = candidate.dish
    values = {
        # Absence of a creamy label is UNKNOWN, never evidence of non-creaminess.
        "less_creamy": -1 if "creamy" in {label.casefold() for label in dish.labels} else 0,
        "lighter": 1 if dish.portion == "light" else 0,
        "spicier": dish.sensory.spice if dish.sensory.spice is not None else 0,
        "adventurous": dish.novelty,
    }
    return sum(values[preference] for preference in intent.preferences)


def order_candidates(candidates: list[RankedDish], intent: RefinementRequest) -> list[RankedDish]:
    return sorted(candidates, key=lambda candidate: (-priority(candidate, intent), -candidate.score, candidate.dish.id))


def explain_refinement(candidate: RankedDish, intent: RefinementRequest) -> RankedDish:
    """Only supported observations are attached; the original quality/score is intact."""
    if not intent.preferences:
        return candidate
    dish = candidate.dish
    evidence, unknowns, differences, reasons = [], [], [], []
    def add(preference, observation, reason=None):
        evidence.append(RecommendationEvidence(kind="session", preference=preference, observation=observation))
        if reason:
            reasons.append(reason)
    if "less_creamy" in intent.preferences:
        if "creamy" in {label.casefold() for label in dish.labels}:
            differences.append("This dish is explicitly labeled creamy. Less creamy is a soft preference; this remains a strong taste match.")
        else:
            unknowns.append("This menu does not establish this dish's creaminess. An absent creamy label does not mean non-creamy or dairy-free.")
    if "lighter" in intent.preferences:
        if dish.portion == "light":
            add("For this meal, you asked for something lighter.", "The menu fixture explicitly marks a light portion.", "Its listed light portion supports today's request for something lighter.")
        else:
            differences.append("This fixture still marks a hearty portion; a lighter option may not qualify within the current budget tier.")
        unknowns.append("Portion labels do not establish calories or nutritional value.")
    if "spicier" in intent.preferences:
        if dish.sensory.spice is not None:
            heat = words("spice", dish.sensory.spice)
            add("For this meal, you asked for more spice.", f"The curated menu heat attribute describes {heat}.", f"For today's heat preference, the menu evidence describes {heat}.")
        else:
            unknowns.append("Heat is undocumented for this dish; no spicy character was assumed.")
    if "adventurous" in intent.preferences:
        add("For this meal, you asked for a more adventurous direction.",
            f"Curated demo discovery annotation: {dish.novelty:g} on a 0–1 scale, not a confidence or personal familiarity score.")
        unknowns.append("Discovery ordering uses a fictional menu annotation; whether this dish is unfamiliar to you remains unknown.")
    compatibility = candidate.compatibility.model_copy(update={
        "evidence": [*candidate.compatibility.evidence, *evidence],
        "uncertainties": [*candidate.compatibility.uncertainties, *unknowns],
        "differences": [*candidate.compatibility.differences, *differences],
    })
    return replace(candidate, compatibility=compatibility, why=" ".join([candidate.why, *reasons[:2]]))


def refinement_result(intent: RefinementRequest, baseline_ids: list[str], selected_ids: list[str]) -> RefinementResult:
    active = bool(intent.preferences or intent.avoid_dish_ids)
    status = "inactive" if not active else "no_alternatives" if not selected_ids else "applied" if selected_ids != baseline_ids else "unchanged"
    message = {
        "inactive": "A small adjustment, just for this meal. Your Taste DNA stays yours.",
        "applied": "Your selection follows today's refinements. Strong matches within your per-dish target still come first.",
        "unchanged": "These refinements do not produce a different strong selection from your original picks under the current budget and safety settings.",
        "no_alternatives": "No other strong dishes meet this request on the current menu. Remove a refinement or reset to reconsider the original picks; your safeguards stay in place.",
    }[status]
    limitations = []
    if "less_creamy" in intent.preferences:
        limitations.append("Less creamy moves explicitly creamy menu labels lower. Other dishes' creaminess is unknown; this is not a dairy restriction.")
    if "lighter" in intent.preferences:
        limitations.append("Lighter favors listed light portions, not lower calories.")
    if "adventurous" in intent.preferences:
        limitations.append("Adventurous uses curated demo discovery annotations, not a claim about foods you have tried.")
    return RefinementResult(request=intent, provider="structured-demo-refinements-v1", status=status, message=message, limitations=limitations)
