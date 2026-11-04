"""Fail-soft pairing enrichment, invoked only after primary picks are finalized."""
from copy import deepcopy
from ..engines import MealPairingEngine
from ..schemas import MealCombinationResult, Recommendation, RecommendationRequest, RestaurantMenu
from .context import build_context
from .reasoning import DemoMealPairingReasoner
from .validation import validate_proposal


def build_meal_combinations(req: RecommendationRequest, menu: RestaurantMenu, primary: list[Recommendation],
                            reasoner: MealPairingEngine | None = None) -> MealCombinationResult:
    reasoner = reasoner or DemoMealPairingReasoner()
    # Adapter metadata is also outside the trusted response boundary.
    try:
        provider = getattr(reasoner, "name", "unavailable")
        mode = getattr(reasoner, "mode", "demo")
        if not isinstance(provider, str) or not provider or mode not in {"demo", "model"}:
            raise ValueError("Invalid provider metadata")
    except Exception:
        return MealCombinationResult(restaurant_id=menu.restaurant.id, menu_version=menu.version,
            provider="unavailable", status="unavailable", unavailable_reason="provider_unavailable",
            uncertainties=["The pairing provider could not be initialized; primary picks are unchanged."])
    def result(combinations=None, reason=None, uncertainties=None, rejected=False):
        combinations = combinations or []
        return MealCombinationResult(restaurant_id=menu.restaurant.id, menu_version=menu.version,
            provider=provider, mode=mode,
            status="limited" if combinations and (rejected or len(combinations) < len(primary)) else "available" if combinations else "unavailable",
            combinations=combinations, unavailable_reason=reason, uncertainties=uncertainties or [])
    if not primary:
        return result(reason="no_primary_picks")
    try:
        context = build_context(req, menu, primary)
    except Exception:
        return result(reason="invalid_context", uncertainties=["The selected menu and primary dishes could not establish a valid pairing context."])
    try:
        # Never let a provider mutate trusted menu, user evidence or the original picks.
        proposals = reasoner.propose(deepcopy(context))
    except Exception:
        return result(reason="provider_unavailable", uncertainties=["Pairing suggestions are unavailable; your primary picks are unchanged."])
    if not isinstance(proposals, list) or len(proposals) > 3:
        return result(reason="invalid_proposal")
    combinations, sets, mains, rejected = [], set(), set(), False
    for proposal in proposals:
        try:
            combination = validate_proposal(proposal, context)
            ids = frozenset([combination.main.item_id, *(item.item_id for item in combination.additions)])
            if ids in sets or combination.main.item_id in mains:
                raise ValueError("Repetitive combination")
            combinations.append(combination)
            sets.add(ids)
            mains.add(combination.main.item_id)
        except Exception:
            rejected = True
    notes = ["Provisional demo pairing; no live culinary model is connected."] if mode == "demo" else []
    if rejected:
        notes.append("Unsupported proposals were omitted without changing your primary picks.")
    if len(combinations) < len(primary):
        notes.append("The menu does not provide enough supported accompaniments for every pick; no missing courses were invented.")
    return result(combinations, reason=None if combinations else "invalid_proposal" if rejected else "insufficient_menu_evidence",
        uncertainties=notes, rejected=rejected)
