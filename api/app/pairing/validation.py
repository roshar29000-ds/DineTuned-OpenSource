"""Independently validate a provider's menu membership, money and cited claims."""
import hashlib
from ..schemas import (AXES, BudgetPosition, MealCombination, MealComponent, MealPairingProposal, PairingExplanation)
from ..services.recommendation_ranking import AXIS_LABELS
from ..tastebridge.validation import sensory_description
from .context import PairingContext
from .evidence import supported_relation


def validate_proposal(raw: MealPairingProposal | dict, context: PairingContext) -> MealCombination:
    proposal = MealPairingProposal.model_validate(raw.model_dump() if isinstance(raw, MealPairingProposal) else raw)
    menu, req = context.menu, context.request
    if (proposal.restaurant_id, proposal.menu_version) != (menu.restaurant.id, menu.version):
        raise ValueError("Proposal menu identity mismatch")
    main_id = proposal.main_dish_id
    if main_id not in context.primary_ids:
        raise ValueError("The main is not an actual primary recommendation")
    ids = [q.item_id for q in proposal.items]
    if len(set(ids)) != len(ids) or main_id not in ids:
        raise ValueError("Duplicate items or missing main")
    additions = [key for key in ids if key != main_id]
    if any(key not in context.eligible_ids for key in ids) or any(key not in context.addition_ids for key in additions):
        raise ValueError("Unavailable, unsafe, unknown-price or unsuitable component")
    items = {d.id: d for c in menu.categories for d in c.items}
    categories = {c.id: c for c in menu.categories}
    for quote in proposal.items:
        item = items[quote.item_id]
        if (quote.amount_minor, quote.currency) != (item.price.amount_minor, item.price.currency):
            raise ValueError("Quoted price is not the exact current menu price")
    subtotal = sum(items[key].price.amount_minor for key in ids)
    if proposal.subtotal_minor != subtotal:
        raise ValueError("Incorrect integer-cent subtotal")
    facts = {fact.id: fact for fact in context.facts}
    seen, used, connected, claims = set(), set(), set(), []
    for link in proposal.claims:
        a, b = facts.get(link.left_fact_id), facts.get(link.right_fact_id)
        pair = (link.left_fact_id, link.right_fact_id)
        if a is None or b is None or a.item_id not in {None, *ids} or b.item_id not in additions or pair in seen:
            raise ValueError("Unrelated, missing or duplicate evidence")
        if supported_relation(a, b) != link.relation:
            raise ValueError("Unsupported culinary claim")
        if link.relation == "different":
            left = {f.value for f in context.facts if f.item_id == a.item_id and f.attribute == a.attribute}
            right = {f.value for f in context.facts if f.item_id == b.item_id and f.attribute == b.attribute}
            if left & right:
                raise ValueError("Overlapping qualities cannot be claimed as a distinct contrast")
        if a.item_id == main_id:
            connected.add(b.item_id)
        if a.attribute in AXES:
            axis = AXIS_LABELS.get(a.attribute, a.attribute)
            if a.item_id is None:
                text = f"Your {'inferred' if a.basis == 'inferred' else 'saved'} {axis} preference and {items[b.item_id].name}'s demo profile both indicate {sensory_description(a.attribute, b.value)}."
            elif link.relation == "shared":
                text = f"Both demo dish profiles indicate {sensory_description(a.attribute, b.value)}."
            else:
                text = f"{items[b.item_id].name}'s demo profile has {'more' if link.relation == 'higher' else 'less'} {axis} than {items[a.item_id].name}."
        elif a.item_id is None:
            text = f"Your {'meal preference' if a.source == 'session' else 'saved preference'} names {a.label}; {items[b.item_id].name}'s menu records {b.label}."
        elif link.relation == "shared":
            text = f"The menus for {items[a.item_id].name} and {items[b.item_id].name} both record {a.label}."
        else:
            text = f"The menu records {a.label} for {items[a.item_id].name} and {b.label} for {items[b.item_id].name}. This does not establish the absence of other qualities."
        claims.append(PairingExplanation(**link.model_dump(), text=text))
        seen.add(pair)
        used.update(pair)
    if connected != set(additions):
        raise ValueError("Every accompaniment needs a supported connection to the main")

    def component(key):
        item = items[key]
        overage = max(0, item.price.amount_minor - req.constraints.max_price_minor)
        return MealComponent(item_id=key, name=item.name, category_id=item.category_id, category_name=categories[item.category_id].name,
            price_minor=item.price.amount_minor, currency=item.price.currency,
            budget=BudgetPosition(target_minor=req.constraints.max_price_minor, overage_minor=overage, status="above_target" if overage else "within_target"))
    # Category and portion provenance remain available alongside relational claims.
    used.update(f.id for f in context.facts if f.item_id in ids and f.attribute in {"category", "portion"})
    names = "; ".join(f"{items[key].name} from {categories[items[key].category_id].name}" for key in additions)
    identity = '|'.join((menu.restaurant.id, menu.version, main_id, *sorted(additions)))
    return MealCombination(id="table-" + hashlib.sha256(identity.encode()).hexdigest()[:16], restaurant_id=menu.restaurant.id,
        menu_version=menu.version, main=component(main_id), additions=[component(key) for key in additions], subtotal_minor=subtotal,
        rationale=f"Alongside {items[main_id].name}: {names}. " + " ".join(claim.text for claim in claims), claims=claims,
        evidence=[fact for fact in context.facts if fact.id in used], uncertainties=[
            "These documented relationships support a provisional pairing, not a guarantee of culinary harmony or personal enjoyment.",
            "Menu attributes and prices are curated fictional examples. Missing qualities were not inferred.",
            "Pairing evidence is not an allergy-safety claim; restaurant confirmation is still needed.",
            "The budget target applies per dish. The subtotal excludes tax, tip and other fees.",
        ])
