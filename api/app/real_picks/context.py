"""Bounded real-source context. No catalog lookup or demo sensory enrichment."""
from dataclasses import dataclass
from hashlib import sha256
import json
from ..culinary.errors import CulinaryError
from ..schemas import AllergenEvidence
from ..services.eligibility import effective_constraints, safety_exclusions
from ..menu_extraction.parsing import Block
from ..menu_extraction.validation import supported
from .models import RealPicksRequest, RealPreference, RealPickExclusion, RealMemoryObservation


def preferences(request, memory=()):
    result = []
    def add(id_, label, source='taste_detective', basis='stated', polarity='like'):
        result.append(RealPreference(id=id_, label=label, source=source, basis=basis, polarity=polarity))
    if request.profile.favorites.strip():
        add('favorites', request.profile.favorites.strip(), 'taste_dna')
    for axis, value in request.profile.axes.model_dump().items():
        if value is not None:
            band = 'low' if value < .34 else 'high' if value > .66 else 'moderate'
            add('axis_'+axis, f'{band} {axis} preference', 'taste_dna',
                'inferred' if axis in request.taste_evidence.inferred_axes else 'stated')
    for field in ('favorite_dishes', 'textures', 'cooking_methods', 'liked_ingredients', 'disliked_ingredients'):
        for value in getattr(request.taste_evidence, field):
            add(field+'_'+str(value), str(value).replace('_', ' '), polarity='dislike' if field == 'disliked_ingredients' else 'like')
    for observation in memory:
        if observation.kind == 'feedback' and observation.polarity != 'neutral':
            add(observation.id, observation.label, 'taste_memory', polarity=observation.polarity)
    return result


def evidence_for(menu, item, field):
    text = getattr(item, field)
    return next((e for e in menu.evidence if e.id in item.evidence_ids
        and supported(text, Block(e.locator, e.quote, e.method, e.page))), None)


@dataclass(frozen=True)
class RealMenuContext:
    request: RealPicksRequest
    eligible_ids: frozenset[str]
    exclusions: tuple[RealPickExclusion, ...]
    preferences: tuple[RealPreference, ...]
    memory: tuple[RealMemoryObservation, ...] = ()
    memory_warning: str | None = None

    @property
    def has_candidates(self): return bool(self.eligible_ids)

    def wire(self):
        req, menu = self.request, self.request.extraction.menu
        result = {'restaurant_id': menu.restaurant_id, 'restaurant_name': menu.restaurant.display_name,
            'menu_version': menu.version, 'complete_restaurant_menu': False,
            'source_provenance': [source.candidate.provenance for source in menu.sources],
            # Document identity is repeated once per source, rather than twice
            # per item. Python has already checked every item/evidence binding.
            'sources': [{'id': source.id, 'url': source.source_url, 'hash': source.source_hash,
                'provenance': source.candidate.provenance} for source in menu.sources],
            'preferences': [p.model_dump() for p in self.preferences],
            'reported_memory': [m.model_dump() for m in self.memory],
            'constraints': req.constraints.model_dump(mode='json'), 'options': req.options.model_dump(),
            'refinements': req.refinements.model_dump(),
            'menu_scope': menu.completeness.status,
            'items': [{'id': d.id, 'name': d.name, 'description': d.description, 'category': c.name,
                'price': d.price.options[0].model_dump(exclude={'raw', 'label'}), 'availability': d.availability,
                'source_evidence': [{'field': field, 'id': ev.id, 'source_id': ev.source_id,
                    'page': ev.page} for field in ('name', 'description')
                    if getattr(d, field) and (ev := evidence_for(menu, d, field))],
                'limitations': d.limitations} for c in menu.categories for d in c.items if d.id in self.eligible_ids]}
        if req._technical_soft_dietary:
            result['technical_soft_dietary_preferences'] = [r.value for r in req._technical_soft_dietary]
        return result

    @property
    def digest(self):
        # Includes the full signed source snapshot and preferences, not just the model projection.
        raw = {'request': self.request.model_dump(mode='json', exclude={'request_id': True, 'extraction': {'recommendation_token'}}),
            'memory': [m.model_dump() for m in self.memory], 'memory_warning': self.memory_warning,
            'technical_soft_dietary': [r.value for r in self.request._technical_soft_dietary]}
        return sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def build_context(request: RealPicksRequest, memory: tuple[RealMemoryObservation, ...] = (),
                  memory_warning: str | None = None) -> RealMenuContext:
    req = RealPicksRequest.model_validate(request.model_dump()).model_copy(deep=True)
    req._technical_soft_dietary = request._technical_soft_dietary
    req.constraints = effective_constraints(req.constraints, req.profile)
    menu = req.extraction.menu
    items = [d for c in menu.categories for d in c.items]
    item_ids = {d.id for d in items}
    if any(identifier not in item_ids for identifier in req.refinements.avoid_dish_ids):
        raise CulinaryError('invalid_refinement', 'A refinement references a dish outside this menu. Reset refinements and try again.')
    if len(memory) > 8:
        raise CulinaryError('context_limit', 'Too many memory observations for one bounded recommendation request.')
    sources = {s.id: s for s in menu.sources}
    evidence = {e.id: e for e in menu.evidence}
    identity = menu.restaurant
    if (req.extraction.restaurant_id != menu.restaurant_id or identity.place_id != menu.restaurant_id
        or identity.source.place_id != menu.restaurant_id or identity.provider != 'google_places'
        or identity.business_status == 'CLOSED_PERMANENTLY'
        or len(items) != menu.total_items or len({i.id for i in items}) != len(items)
        or len({c.id for c in menu.categories}) != len(menu.categories)
        or len(sources) != len(menu.sources) or len(evidence) != len(menu.evidence)
        or any(d.category_id != c.id for c in menu.categories for d in c.items)):
        raise CulinaryError('invalid_menu', 'The extracted menu identity or item structure could not be verified.')
    if any(e.source_id not in sources or sources[e.source_id].source_hash != e.source_hash
           or sources[e.source_id].source_url != e.source_url for e in menu.evidence):
        raise CulinaryError('invalid_evidence', 'The menu evidence does not match the extracted source documents.')
    blocked = {i for issue in menu.issues if issue.severity == 'blocked' or issue.code == 'conflicting_duplicate' for i in issue.item_ids}
    global_block = any(i.severity == 'blocked' and not i.item_ids and not i.source_id for i in menu.issues)
    valid_sources = {s.id for s in menu.sources if s.status in ('parsed', 'partial') and s.source_hash and s.retrieved_at
        and s.candidate.suitable_for_extraction and s.candidate.access == 'checked'
        and s.candidate.freshness != 'outdated' and s.candidate.menu_type in ('dine_in', 'unknown')
        and (s.candidate.branch_relevance == 'exact' or s.candidate.provenance == 'user_upload'
             and s.candidate.branch_relevance == 'unknown'
             and s.source_url == 'urn:dinetuned:upload:' + s.source_hash)}
    allowed, exclusions = set(), []
    for item in items:
        reasons = []
        if global_block or item.id in blocked: reasons.append('extraction_needs_review')
        if item.availability == 'listed_unavailable': reasons.append('unavailable')
        if item.id in req.refinements.avoid_dish_ids: reasons.append('refinement_avoided')
        if any(m.kind == 'feedback' and m.polarity == 'dislike' and
               (m.restaurant_id, m.menu_version, m.dish_id) == (menu.restaurant_id, menu.version, item.id)
               for m in memory): reasons.append('reported_dislike')
        refs = [evidence.get(id_) for id_ in item.evidence_ids]
        if (not refs or any(e is None or e.source_id not in valid_sources for e in refs)
            or not evidence_for(menu, item, 'name') or item.description and not evidence_for(menu, item, 'description')):
            reasons.append('unverified_source_evidence')
        price = item.price
        option = price.options[0] if len(price.options) == 1 else None
        if (price.kind != 'fixed' or not price.budget_usable or option is None
            or type(option.amount_minor) is not int or option.amount_minor < 0
            or option.evidence_id not in item.evidence_ids): reasons.append('price_unverified')
        elif option.currency != req.constraints.currency: reasons.append('currency_mismatch')
        elif not req.options.include_over_budget and option.amount_minor > req.constraints.max_price_minor:
            reasons.append('above_budget_hidden')
        # Extraction currently certifies neither dietary suitability nor cross-contact
        # controls. Never infer them from a name, ingredient omission, or model output.
        reasons.extend(e.code for e in safety_exclusions({}, AllergenEvidence(), req.constraints))
        if reasons: exclusions.append(RealPickExclusion(item_id=item.id, reasons=list(dict.fromkeys(reasons))))
        else: allowed.add(item.id)
    if len(allowed) > 60:
        raise CulinaryError('context_limit', 'This menu exceeds the bounded single-request context. No dishes were silently sampled and no model request was made.')
    return RealMenuContext(req, frozenset(allowed), tuple(exclusions), tuple(preferences(req, memory)), memory, memory_warning)
