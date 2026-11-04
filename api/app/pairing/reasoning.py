"""Replaceable demo composition rules; no aggregate culinary ranking or confidence.

Choose one documented accompaniment per primary, favor variety and saved clues,
then a within-target item. This is a provisional proposal, not proof of harmony.
"""
from collections import defaultdict
from ..schemas import AXES, MealPairingProposal, PairingLink, PairingQuote
from .context import PairingContext
from .evidence import supported_relation


class DemoMealPairingReasoner:
    name = "structured_demo_pairing_v1"
    mode = "demo"

    def propose(self, context: PairingContext) -> list[MealPairingProposal]:
        items = {d.id: d for c in context.menu.categories for d in c.items}
        by_item = defaultdict(list)
        for fact in context.facts:
            by_item[fact.item_id].append(fact)
        used, seen, proposals = set(), set(), []
        mood_axis = {"fresh": "freshness", "cozy": "richness", "bold": "spice"}.get(context.request.constraints.mood)
        for main_id in context.primary_ids:
            if main_id not in context.eligible_ids:
                continue
            choices = []
            for item_id in context.addition_ids:
                if item_id == main_id or frozenset((main_id, item_id)) in seen:
                    continue
                culinary, personal = [], []
                for a in [*by_item[main_id], *by_item[None]]:
                    for b in by_item[item_id]:
                        if not (relation := supported_relation(a, b)):
                            continue
                        link = PairingLink(left_fact_id=a.id, right_fact_id=b.id, relation=relation)
                        if a.item_id is None:
                            personal.append(link)
                        elif a.attribute in {"ingredient", "texture", "cooking"} or (
                            a.attribute in AXES and abs(a.value - b.value) >= .2):
                            culinary.append((a.attribute, link))
                if not culinary:
                    continue  # A category label alone cannot establish a meaningful pairing.
                culinary.sort(key=lambda value: (value[0] != mood_axis, value[0] not in {"texture", "cooking", "ingredient"}, value[0]))
                # At most one sensory connection and one direct saved preference;
                # no claim that unmeasured taste dimensions are known.
                claims = [culinary[0][1], *personal[:1]]
                choices.append((item_id, claims, bool(personal)))
            if not choices:
                continue
            choices.sort(key=lambda value: (value[0] in used, not value[2],
                items[value[0]].price.amount_minor > context.request.constraints.max_price_minor, value[0]))
            item_id, claims, _ = choices[0]
            quotes = [PairingQuote(item_id=key, amount_minor=items[key].price.amount_minor, currency=items[key].price.currency) for key in (main_id, item_id)]
            proposals.append(MealPairingProposal(restaurant_id=context.menu.restaurant.id, menu_version=context.menu.version,
                main_dish_id=main_id, items=quotes, subtotal_minor=sum(q.amount_minor for q in quotes), claims=claims))
            used.add(item_id)
            seen.add(frozenset((main_id, item_id)))
        return proposals
