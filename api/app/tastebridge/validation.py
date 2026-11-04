"""Validate references and relations independently of the reasoning provider.

No provider-authored prose is accepted as fact. Public copy is rendered from the
validated claim graph, so an evidence citation cannot launder an unrelated claim.
"""
from ..schemas import AXES, BridgeComparison, BridgeProposal, StructuredTasteBridge
from ..services.recommendation_ranking import AXIS_LABELS, words
from .context import BridgeContext
from .relations import intensity_band, supported_relation


def sensory_description(axis: str, value: float) -> str:
    # Low crunch does not prove softness (a dish might be chewy). Keep numeric
    # sensory evidence separate from explicitly documented texture features.
    if axis == "crunch":
        return ("little crunch", "moderate crunch", "pronounced crunch")[intensity_band(value)]
    return words(axis, value)


def validate_proposal(raw: BridgeProposal | dict, context: BridgeContext, provider: str) -> StructuredTasteBridge:
    proposal = BridgeProposal.model_validate(raw.model_dump() if isinstance(raw, BridgeProposal) else raw)
    if (proposal.restaurant_id, proposal.menu_version, proposal.dish_id) != (context.restaurant_id, context.menu_version, context.dish_id):
        raise ValueError("Proposal identity does not match the selected dish")
    anchor = next((a for a in context.anchors if a.id == proposal.anchor_id), None)
    if anchor is None:
        raise ValueError("Unsubstantiated familiar anchor")
    facts = {fact.id: fact for fact in context.facts}
    seen = set()

    def validate_link(link, expected_shared):
        a, b = facts.get(link.anchor_fact_id), facts.get(link.target_fact_id)
        pair = (link.anchor_fact_id, link.target_fact_id)
        if pair in seen:
            raise ValueError("Duplicate or contradictory comparison")
        seen.add(pair)
        if a is None or b is None or a.id not in anchor.evidence_ids or b.subject != "target":
            raise ValueError("Comparison references unrelated evidence")
        if supported_relation(a, b) != link.relation or (link.relation == "shared") != expected_shared:
            raise ValueError("Comparison is unsupported by the cited facts")
        if link.relation == "different":
            left_values = {facts[key].value for key in anchor.evidence_ids if facts[key].attribute == a.attribute}
            right_values = {f.value for f in context.facts if f.subject == "target" and f.attribute == a.attribute}
            if left_values & right_values:
                raise ValueError("Cannot contrast partially overlapping feature sets as different")
        user = anchor.kind == "saved_preferences"
        if a.attribute in AXES:
            axis = AXIS_LABELS.get(a.attribute, a.attribute)
            if link.relation == "shared":
                text = (f"Your saved {axis} preference and {context.dish_name}'s demo profile both indicate {sensory_description(a.attribute, b.value)}."
                    if user else f"Both demo dish profiles indicate {sensory_description(a.attribute, b.value)}.")
            else:
                text = f"{context.dish_name}'s demo profile has {'more' if link.relation == 'higher' else 'less'} {axis} than {'your saved preference' if user else anchor.label}."
        elif link.relation == "shared":
            if user:
                text = f"You named {a.label} among your preferences; {context.dish_name}'s menu lists {b.label}."
                if a.attribute == "family":
                    text = f"You named {a.label} among your favorites; {context.dish_name} belongs to that broad demo dish family."
            else:
                text = f"Both menus record {a.label}." if a.label == b.label else f"The menus list {a.label} and {b.label}, connected by the {a.value} ingredient group."
        else:
            text = f"{context.dish_name}'s menu records {b.label}, while {'your saved preference names ' + a.label if user else anchor.label + ' records ' + a.label}. This does not establish the absence of other qualities."
        return BridgeComparison(**link.model_dump(), attribute=a.attribute, text=text)

    shared = [validate_link(link, True) for link in proposal.shared]
    differences = [validate_link(link, False) for link in proposal.differences]
    used = {key for link in [*shared, *differences] for key in (link.anchor_fact_id, link.target_fact_id)}
    # The rating establishes familiarity, but never establishes why it was liked.
    used.update(key for key in anchor.evidence_ids if facts[key].attribute == "liked")
    intro = f"You reported liking {anchor.label}. " if anchor.kind == "liked_dish" else "From your saved taste preferences: "
    explanation = intro + " ".join(c.text for c in shared[:2]) + " These documented connections may appeal to you."
    if differences:
        explanation += " " + differences[0].text
    uncertainty = list(context.uncertainties)
    uncertainty.append("A shared quality does not establish an identical overall flavor.")
    if anchor.kind == "liked_dish":
        uncertainty.append("A positive rating does not tell us which qualities you liked; feedback is a user report, not verified culinary evidence.")
    else:
        uncertainty.append("This connects saved preferences, not a verified sensory profile of a specific favorite dish.")
    if not differences:
        uncertainty.append("There is insufficient comparable evidence for a specific difference; no difference was invented.")
    unknown = [axis for axis in AXES if not any(f.attribute == axis and f.subject == "target" for f in context.facts)
        or not any(facts[key].attribute == axis for key in anchor.evidence_ids)]
    if unknown:
        uncertainty.append("Uncompared dimensions: " + ", ".join(unknown) + ".")
    public_anchor = anchor.model_copy(update={"evidence_ids": [key for key in anchor.evidence_ids if key in used]})
    return StructuredTasteBridge(provider=provider, status="grounded" if anchor.kind == "liked_dish" and len(shared) >= 2 else "limited",
        restaurant_id=context.restaurant_id, menu_version=context.menu_version, dish_id=context.dish_id,
        anchor=public_anchor, shared=shared, differences=differences, explanation=explanation,
        evidence=[f for f in context.facts if f.id in used], uncertainties=uncertainty)
