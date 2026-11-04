"""Reasoning failure only suppresses a bridge, never changes a selected dish."""
from copy import deepcopy
from pydantic import ValidationError
from ..engines import TasteBridgeEngine
from ..schemas import MenuItem, RecommendationRequest, RestaurantMenu, StructuredTasteBridge
from .context import ContradictoryEvidence, build_context
from .reasoning import DemoTasteBridgeReasoner
from .validation import validate_proposal


def build_taste_bridge(req: RecommendationRequest, menu: RestaurantMenu, dish: MenuItem,
                      reasoner: TasteBridgeEngine | None = None) -> StructuredTasteBridge:
    reasoner = reasoner or DemoTasteBridgeReasoner()
    def unavailable(reason, uncertainties):
        return StructuredTasteBridge(provider=reasoner.name, status="unavailable", restaurant_id=menu.restaurant.id,
            menu_version=menu.version, dish_id=dish.id, unavailable_reason=reason, uncertainties=uncertainties)
    try:
        context = build_context(req, menu, dish)
    except ContradictoryEvidence:
        return unavailable("contradictory_evidence", ["Saved dislikes or negative feedback conflict with an affirmative comparison; no TasteBridge was published."])
    except ValueError:
        return unavailable("ineligible", ["The dish or menu could not be validated against this request and its hard safeguards."])
    try:
        # A provider cannot mutate the trusted facts used by validation.
        proposal = reasoner.propose(deepcopy(context))
    except Exception:
        return unavailable("provider_unavailable", ["TasteBridge reasoning is unavailable. Your selected dishes have not changed."])
    if proposal is None:
        return unavailable("insufficient_evidence", [*context.uncertainties, "No supported familiar connection is available; no comparison was invented."])
    try:
        return validate_proposal(proposal, context, reasoner.name)
    except (ValueError, ValidationError, TypeError):
        return unavailable("invalid_proposal", ["The proposed comparison could not be supported by the available evidence and was not published."])
