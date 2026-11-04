"""Adapter around existing demo logic, not a second culinary ranker."""
from ..services.recommendation_ranking import rank_dish
from ..services.demo_refinements import order_candidates
from ..tastebridge.reasoning import DemoTasteBridgeReasoner
from .context import CulinaryContext
from .contracts import CandidateProposal, CulinaryProposal, FactClaim, ProviderOutput


class DemoCulinaryProvider:
    def propose(self, context: CulinaryContext) -> ProviderOutput:
        ranked = [rank_dish(d, context.request) for c in context.menu.categories for d in c.items if d.id in context.bridges]
        candidates = []
        for entry in order_candidates([c for c in ranked if c.qualified], context.request.refinements):
            bridge_context = context.bridges[entry.dish.id]
            bridge = DemoTasteBridgeReasoner().propose(bridge_context)
            if not bridge:
                continue
            facts = {f.id: f for f in bridge_context.facts}
            shared = bridge.shared[:3]
            claims = [FactClaim(fact_id=link.target_fact_id, attribute=facts[link.target_fact_id].attribute,
                value=facts[link.target_fact_id].value) for link in shared]
            candidates.append(CandidateProposal(item_id=entry.dish.id, fit="strong", claims=claims, anchor_id=bridge.anchor_id,
                shared=shared, differences=bridge.differences[:2], uncertainties=["incomplete_menu"]))
        return ProviderOutput(provider="existing-deterministic-demo", mode="demo", model=None,
            proposal=CulinaryProposal(restaurant_id=context.menu.restaurant.id, menu_version=context.menu.version, candidates=candidates))
