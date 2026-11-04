"""Signature demo selections: hard safeguards, evidence quality, then soft budget tiers."""
from datetime import datetime, timezone
from uuid import uuid4
from collections import Counter
from fastapi import HTTPException
from .schemas import (BudgetPosition, MenuItem, PersonalizedDish, Recommendation, RecommendationRequest, RecommendationSession,
                      RestaurantMenu, TasteBridge, TasteProfile, WorthTheStretchResult)
from .services.catalog import get_menu
from .services.eligibility import effective_constraints, evaluate_menu, recommendation_eligible
from .services.recommendation_ranking import AXIS_LABELS, RankedDish, matching_axes, rank_dish, words
from .tastebridge.service import build_taste_bridge
from .pairing.service import build_meal_combinations
from .services.demo_refinements import explain_refinement, order_candidates, refinement_result


def explain(item: MenuItem, profile: TasteProfile) -> tuple[str, TasteBridge]:
    """Retained compatibility preview; full TasteBridge remains a separate milestone."""
    close = [(axis, value, diff) for axis, value, diff in matching_axes(item, profile) if diff <= .3][:2]
    clues = [words(axis, value) for axis, value, _ in close]
    why = f"Its {' and '.join(clues)} align with your taste settings." if clues else "More taste evidence is needed to establish a personal connection."
    return why, TasteBridge(connection=why, contrast="See the listed differences and unknowns for this demo comparison.",
        evidence=[f"{axis}: curated menu attribute {value:g}, taste setting {getattr(profile.axes, axis):g}." for axis, value, _ in close])


def present_dish(candidate: RankedDish, req: RecommendationRequest, menu: RestaurantMenu) -> PersonalizedDish:
    """Assemble prices and validated explanations independently of culinary ranking."""
    _, bridge = explain(candidate.dish, req.profile)
    overage = max(0, candidate.dish.price.amount_minor - req.constraints.max_price_minor)
    return PersonalizedDish(dish=candidate.dish, why=candidate.why, bridge=bridge,
        compatibility=candidate.compatibility, taste_bridge=build_taste_bridge(req, menu, candidate.dish),
        budget=BudgetPosition(target_minor=req.constraints.max_price_minor, overage_minor=overage,
                              status="above_target" if overage else "within_target"))


def recommend(req: RecommendationRequest) -> RecommendationSession:
    menu = get_menu(req.restaurant_id, req.menu_version)
    constraints = effective_constraints(req.constraints, req.profile)
    req = req.model_copy(update={"constraints": constraints})
    evaluation = evaluate_menu(menu, constraints)  # Strict Smart Menu semantics are unchanged.
    permitted = {result.item_id for result in evaluation.items if recommendation_eligible(result)}
    dishes = [item for category in menu.categories for item in category.items]
    identities = Counter(item.id for item in dishes)
    if any(identities[identifier] != 1 for identifier in req.refinements.avoid_dish_ids):
        raise HTTPException(status_code=422, detail="Refinements must reference unique dishes in the selected menu. Reset refinements and try again.")
    # Conflicting duplicate identities cannot establish one reliable dish.
    candidates = [rank_dish(item, req) for item in dishes if item.id in permitted and identities[item.id] == 1]
    original = sorted([candidate for candidate in candidates if candidate.qualified], key=lambda c: (-c.score, c.dish.id))
    baseline = [c for c in original if c.dish.price.amount_minor <= constraints.max_price_minor]
    if req.options.include_over_budget:
        baseline += [c for c in original if c.dish.price.amount_minor > constraints.max_price_minor]
    # Provider ordering cannot admit poor/unsafe matches or override budget tiers.
    remaining = [candidate for candidate in original if candidate.dish.id not in req.refinements.avoid_dish_ids]
    excellent = [explain_refinement(candidate, req.refinements) for candidate in order_candidates(remaining, req.refinements)]
    within = [candidate for candidate in excellent if candidate.dish.price.amount_minor <= constraints.max_price_minor]
    above = [candidate for candidate in excellent if candidate.dish.price.amount_minor > constraints.max_price_minor]
    selected = (within + (above if req.options.include_over_budget else []))[:3]
    recommendations = [Recommendation(category=("Best match", "Comfort pick", "Discovery pick")[index],
        **present_dish(candidate, req, menu).model_dump()) for index, candidate in enumerate(selected)]
    selected_ids = {candidate.dish.id for candidate in selected}
    # Reuse the SAME qualified ranking and hard-eligible pool, never a second scorer.
    # A future culinary provider can replace rank_dish; selection/price assembly stays here.
    stretch = [candidate for candidate in above if candidate.dish.id not in selected_ids][:2] if req.options.include_over_budget else []
    empty_reason = None
    if not recommendations:
        if not candidates:
            empty_reason = "hard_exclusions"
            message = "No dishes pass the dietary, allergy, availability, and known-price safeguards. Your restrictions have not been relaxed."
        elif excellent:
            empty_reason = "over_budget_hidden"
            message = "The strongest available matches are above your target and are currently hidden."
        elif original and req.refinements.avoid_dish_ids:
            empty_reason = "no_alternatives"
            message = "No unseen strong dishes remain under these preferences. Reset refinements to reconsider your earlier picks."
        elif any(candidate.rejection_reason == "insufficient_evidence" for candidate in candidates):
            empty_reason = "insufficient_evidence"
            missing = [AXIS_LABELS.get(axis, axis) for axis, value in req.profile.axes.model_dump().items()
                if value is None and any(getattr(candidate.dish.sensory, axis) is not None for candidate in candidates)]
            next_step = "Add your preference for " + " or ".join(missing[:2]) + " in Taste DNA." if missing else "Revisit your saved dish preferences in Taste Detective."
            message = "There is not enough shared taste evidence to choose a personal pick yet. " + next_step + " Unknown preferences have not been filled in."
        else:
            empty_reason = "no_strong_matches"
            message = "No dish clears the demo's taste-evidence threshold with these preferences. We won't fill the space with weak matches."
    else:
        count, over = len(recommendations), sum(rec.budget.overage_minor > 0 for rec in recommendations)
        message = f"{count} considered {'choice' if count == 1 else 'choices'} from the complete menu. " + (f"{over} above your target, with the exact difference shown." if over else "Each is within your per-dish target.")
    return RecommendationSession(id=str(uuid4()), created_at=datetime.now(timezone.utc), restaurant=menu.restaurant,
        menu_version=menu.version, constraints=constraints, recommendations=recommendations, evaluation=evaluation, message=message,
        profile=req.profile, taste_evidence=req.taste_evidence, options=req.options, bridge_feedback=req.bridge_feedback,
        refinement_result=refinement_result(req.refinements, [c.dish.id for c in baseline[:3]], [c.dish.id for c in selected]),
        meal_combinations=build_meal_combinations(req, menu, recommendations),
        worth_the_stretch=WorthTheStretchResult(restaurant_id=menu.restaurant.id, menu_version=menu.version,
            provider="deterministic-v3.4a", picks=[present_dish(candidate, req, menu) for candidate in stretch]),
        hard_eligible_count=len(candidates), qualified_count=len(excellent), within_budget_qualified_count=len(within), above_budget_qualified_count=len(above), empty_reason=empty_reason)
