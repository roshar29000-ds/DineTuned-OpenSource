"""Validate citations and constraints, never independently score culinary harmony."""
from collections import Counter
from ..culinary.errors import CulinaryError
from ..schemas import BudgetPosition
from .context import build_context, evidence_for, RealMenuContext
from .models import (RealProviderOutput, RealPersonalizedPick, RealPickConnection,
    RealPickExclusion, RealTasteBridge, RealMealItem, RealMealCombination)


def preference_label(preference):
    label = preference.label.strip()
    for prefix in ('high ', 'moderate ', 'low '):
        if label.lower().startswith(prefix):
            label = label[len(prefix):]
            break
    return label.removesuffix(' preference')


def taste_line(preference):
    label = preference_label(preference)
    if preference.source == 'taste_memory':
        return f'It may echo a taste you noted after dining: {label}.'
    if preference.basis == 'stated':
        return f'It may suit your taste for {label}.'
    return f'If {label} appeals to you, this could be worth exploring.'


def source_sentence(value):
    text = value.strip()
    return text if text.endswith(('.', '!', '?')) else text + '.'


def validate_output(output: RealProviderOutput, context: RealMenuContext):
    output = RealProviderOutput.model_validate(output.model_dump())
    trusted = build_context(context.request, context.memory, context.memory_warning)
    menu, proposal = trusted.request.extraction.menu, output.proposal
    if (proposal.restaurant_id, proposal.menu_version) != (menu.restaurant_id, menu.version):
        raise CulinaryError('stale_output', 'The model response belongs to a different restaurant or menu version.')
    items = {d.id: (d, c.name) for c in menu.categories for d in c.items}
    preferences = {p.id: p for p in trusted.preferences}
    counts = Counter(c.item_id for c in proposal.candidates)
    valid, rejected = [], []
    for candidate in proposal.candidates:
        reason = None
        if candidate.item_id not in items: reason = 'unknown_item'
        elif counts[candidate.item_id] != 1: reason = 'duplicate_item'
        elif candidate.item_id not in trusted.eligible_ids: reason = 'ineligible_item'
        elif candidate.fit == 'tentative' or 'possible_dislike' in candidate.uncertainty: reason = 'insufficient_match'
        if reason:
            rejected.append(RealPickExclusion(item_id=candidate.item_id, reasons=[reason])); continue
        dish, category = items[candidate.item_id]
        connections = []
        for link in candidate.connections:
            preference = preferences.get(link.preference_id)
            evidence = evidence_for(menu, dish, link.field)
            if (not preference or preference.polarity != 'like' or not evidence
                or link.quote != getattr(dish, link.field)
                or any(c.preference.id == link.preference_id for c in connections)):
                reason = 'unsupported_personal_connection'; break
            connections.append(RealPickConnection(preference=preference, menu_quote=link.quote, field=link.field, evidence=evidence))
        amount = dish.price.options[0].amount_minor
        target = trusted.request.constraints.max_price_minor
        overage = max(0, amount - target)
        if overage and candidate.fit != 'exceptional': reason = 'above_budget_not_exceptional'
        if reason:
            rejected.append(RealPickExclusion(item_id=candidate.item_id, reasons=[reason])); continue
        explanations = [f'{source_sentence(c.menu_quote)} {taste_line(c.preference)}' if c.field == 'description'
            else f'{dish.name} is listed on the menu. {taste_line(c.preference)}' for c in connections]
        valid.append(RealPersonalizedPick(dish=dish, category_name=category, fit=candidate.fit,
            explanation=' '.join(explanations), connections=connections, price_minor=amount,
            budget=BudgetPosition(target_minor=target, overage_minor=overage, status='above_target' if overage else 'within_target'),
            limitations=list(dict.fromkeys([*dish.limitations, 'Listed in the source menu; current availability is unverified.',
                'Ingredients and cross-contact are not fully verified. Confirm with restaurant staff.',
                'The preference connection is a model judgment, not a calibrated prediction.',
                *['Provider noted: '+flag.replace('_', ' ')+'.' for flag in candidate.uncertainty]]))))
    within = [p for p in valid if not p.budget.overage_minor]
    above = [p for p in valid if p.budget.overage_minor] if trusted.request.options.include_over_budget else []
    primary = (within + above)[:3]
    primary_ids = {p.dish.id for p in primary}
    stretch = [p for p in above if p.dish.id not in primary_ids][:2]
    bridges = []
    for pick in [*primary, *stretch]:
        anchor = pick.connections[0]
        bridges.append(RealTasteBridge(item_id=pick.dish.id, anchor=anchor.preference,
            menu_quote=anchor.menu_quote, evidence=anchor.evidence,
            connection=f'The menu describes {pick.dish.name} as “{anchor.menu_quote}”. {taste_line(anchor.preference)}',
            uncertainty='This is a source-linked taste connection, not proof that the dishes share ingredients or preparation.'))
    combinations = []
    seen = set()
    for pairing in proposal.pairings:
        key = (pairing.main_id, *pairing.addition_ids)
        if (key in seen or pairing.main_id not in primary_ids
            or len(set(pairing.addition_ids)) != len(pairing.addition_ids)
            or pairing.main_id in pairing.addition_ids
            or any(identifier in primary_ids or identifier in {p.dish.id for p in stretch}
                   for identifier in pairing.addition_ids)
            or any(identifier not in trusted.eligible_ids for identifier in pairing.addition_ids)):
            continue
        seen.add(key)
        additions = []
        for identifier in pairing.addition_ids:
            item, category = items[identifier]
            evidence = evidence_for(menu, item, 'description' if item.description else 'name')
            if not evidence:
                additions = []; break
            additions.append(RealMealItem(dish=item, category_name=category,
                price_minor=item.price.options[0].amount_minor, evidence=evidence))
        if not additions: continue
        main = next(p for p in primary if p.dish.id == pairing.main_id)
        rationale = (f'Consider {", ".join(a.dish.name for a in additions)} alongside {main.dish.name}. '
            + ' '.join(f'The supplied menu lists {a.dish.name} as “{a.dish.description or a.dish.name}”.' for a in additions))
        combinations.append(RealMealCombination(main_item_id=main.dish.id, additions=additions,
            subtotal_minor=main.price_minor + sum(a.price_minor for a in additions), rationale=rationale,
            limitations=['Pairing harmony is a model judgment based on menu text, not a verified portion or ingredient claim.',
                'Subtotal excludes tax, tip and fees; the budget target applies per dish.',
                'Current availability and cross-contact controls are unverified.']))
    return primary, rejected, stretch, bridges, combinations
