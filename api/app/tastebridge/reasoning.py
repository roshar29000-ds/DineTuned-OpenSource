"""Provisional fact-linking reasoner. Replace this provider with a Meta adapter.

It chooses a familiar anchor and supported links. It never selects/ranks dishes,
infers missing traits, interprets free text, or changes safeguards.
"""
from ..schemas import BridgeLink, BridgeProposal
from .context import BridgeContext
from .relations import supported_relation


class DemoTasteBridgeReasoner:
    name = "structured_demo_v1"

    def propose(self, context: BridgeContext) -> BridgeProposal | None:
        facts = {fact.id: fact for fact in context.facts}
        target = [fact for fact in context.facts if fact.subject == "target"]
        for anchor in sorted(context.anchors, key=lambda a: (a.kind != "liked_dish", a.id)):
            left = [facts[key] for key in anchor.evidence_ids]
            shared, differences = [], []
            for attribute in ["family", "texture", "cooking", "ingredient", "spice", "richness", "freshness", "crunch", "aromatic", "sweetness", "umami"]:
                pairs = [(a, b, supported_relation(a, b)) for a in left for b in target if a.attribute == b.attribute == attribute]
                matches = [BridgeLink(anchor_fact_id=a.id, target_fact_id=b.id, relation=r) for a, b, r in pairs if r == "shared"]
                if matches:
                    shared.extend(matches)
                else:
                    differences.extend(BridgeLink(anchor_fact_id=a.id, target_fact_id=b.id, relation=r) for a, b, r in pairs if r)
            if shared:
                return BridgeProposal(restaurant_id=context.restaurant_id, menu_version=context.menu_version, dish_id=context.dish_id,
                    anchor_id=anchor.id, shared=shared[:6], differences=differences[:4])
        return None
