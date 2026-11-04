"""No culinary re-ranking: validate proposals, then apply existing budget tiers.

Provider prose is deliberately not a factual channel. Model-selected connections
are checked against trusted facts and rendered using the existing TasteBridge
validator, so a citation cannot launder invented ingredients or preparation.
"""
from collections import Counter
from ..schemas import BridgeProposal, BudgetPosition
from ..tastebridge.validation import validate_proposal as validate_bridge
from .context import CulinaryContext, build_context
from .contracts import ProviderOutput, CulinarySelection, ValidatedCulinaryPick
from .errors import CulinaryError


def validate_output(output: ProviderOutput, context: CulinaryContext) -> CulinarySelection:
    output = ProviderOutput.model_validate(output.model_dump())
    proposal = output.proposal
    if (proposal.restaurant_id, proposal.menu_version) != (context.menu.restaurant.id, context.menu.version):
        raise CulinaryError("stale_output", "The provider returned a different restaurant or menu version.")
    # Rebuild eligibility/facts independently of any provider-side filtering.
    trusted = build_context(context.request, context.menu)
    items = {d.id: (d, c.name) for c in trusted.menu.categories for d in c.items}
    counts = Counter(c.item_id for c in proposal.candidates)
    valid, rejected = [], []
    for candidate in proposal.candidates:
        reason = None
        if candidate.item_id not in items:
            reason = "unknown_item"
        elif counts[candidate.item_id] != 1:
            reason = "duplicate_item"
        elif candidate.item_id not in trusted.bridges:
            reason = "ineligible_item"
        elif candidate.fit != "strong":
            reason = "tentative_fit"
        else:
            bridge_context = trusted.bridges[candidate.item_id]
            facts = {f.id: f for f in bridge_context.facts}
            try:
                if not candidate.claims or len({c.fact_id for c in candidate.claims}) != len(candidate.claims):
                    raise ValueError("Missing or duplicate claims")
                for claim in candidate.claims:
                    fact = facts.get(claim.fact_id)
                    if not fact or fact.subject != "target" or fact.attribute != claim.attribute or fact.value != claim.value:
                        raise ValueError("Unsupported factual claim")
                bridge = validate_bridge(BridgeProposal(restaurant_id=proposal.restaurant_id, menu_version=proposal.menu_version,
                    dish_id=candidate.item_id, anchor_id=candidate.anchor_id, shared=candidate.shared,
                    differences=candidate.differences), bridge_context, output.provider)
                linked = {link.target_fact_id for link in candidate.shared}
                if not linked.intersection(c.fact_id for c in candidate.claims):
                    raise ValueError("The taste connection has no corresponding menu claim")
            except (ValueError, TypeError):
                reason = "unsupported_evidence"
            else:
                dish, category = items[candidate.item_id]
                overage = max(0, dish.price.amount_minor - trusted.request.constraints.max_price_minor)
                evidence = {fact.id: fact for fact in [*bridge.evidence, *(facts[c.fact_id] for c in candidate.claims)]}
                valid.append(ValidatedCulinaryPick(dish=dish, category_name=category, explanation=bridge.explanation,
                    evidence=list(evidence.values()), uncertainties=[*bridge.uncertainties,
                        "Model fit judgments may be wrong even when their cited facts are valid.",
                        *[f"Provider flagged: {flag.replace('_', ' ')}." for flag in dict.fromkeys(candidate.uncertainties)]],
                    taste_bridge=bridge, budget=BudgetPosition(target_minor=trusted.request.constraints.max_price_minor,
                        overage_minor=overage, status="above_target" if overage else "within_target")))
        if reason:
            rejected.append({"item_id": candidate.item_id, "reason": reason})
    within = [pick for pick in valid if pick.budget.overage_minor == 0]
    above = [pick for pick in valid if pick.budget.overage_minor > 0] if trusted.request.options.include_over_budget else []
    primary = (within + above)[:3]
    primary_ids = {pick.dish.id for pick in primary}
    return CulinarySelection(restaurant_id=proposal.restaurant_id, menu_version=proposal.menu_version,
        provider=output.provider, mode=output.mode, model=output.model, context_digest=context.digest,
        recommendations=primary, worth_the_stretch=[p for p in above if p.dish.id not in primary_ids][:2], rejected=rejected)
