"""Process-local one-shot gate for an explicitly approved developer test.

The locked usage ledger is the durable second gate across process restarts.
"""
from threading import Lock
from uuid import UUID
import re
from fastapi import Depends, HTTPException
from ..culinary.errors import CulinaryError
from ..culinary.meta import LiveConsent, MetaCulinaryProvider
from ..persistence.auth import UserIdentity
from ..persistence.routes import get_user
from ..schemas import DietaryRestriction
from .models import (RealPicksCapability, RealPicksRequest, RealPicksResult,
                     RealCulinaryProposal, RealProviderOutput)
from .provider import SYSTEM
from . import routes


TECHNICAL_NOTICE = ('TECHNICAL TEST ONLY — dietary compliance has not been verified, including no beef/pork. '
    'This selection is for model evaluation, not a dietary-safe ordering recommendation. '
    'Confirm every dish and ingredient with restaurant staff.')
EXPLICIT_BEEF_PORK = re.compile(r'\b(?:beef|pork|pig|bacon|prosciutto|pancetta|ham|skirt\s+steak)\b', re.I)


class TechnicalDietTestPolicy:
    """One runner-only, user-authorized change to a request copy, never saved DNA."""
    def prepare(self, request: RealPicksRequest) -> RealPicksRequest:
        working = request.model_copy(deep=True)
        softened = {DietaryRestriction.no_beef, DietaryRestriction.no_pork}
        active = set(working.profile.dietary_restrictions) | set(working.constraints.dietary_restrictions)
        if not softened <= active:
            raise CulinaryError('test_scope', 'This technical test requires both stated no-beef and no-pork settings in the current app. No model request was made.')
        working._technical_soft_dietary = tuple(sorted(active, key=lambda restriction: restriction.value))
        working.profile.dietary_restrictions = []
        working.constraints.dietary_restrictions = []
        explicit = [item.id for category in working.extraction.menu.categories for item in category.items
                    if EXPLICIT_BEEF_PORK.search(item.name + ' ' + item.description)]
        avoided = list(dict.fromkeys([*working.refinements.avoid_dish_ids, *explicit]))
        if len(avoided) > 50:
            raise CulinaryError('test_scope', 'Too many exclusions for the bounded technical test. No model request was made.')
        working.refinements.avoid_dish_ids = avoided
        return working

    def label(self, result: RealPicksResult) -> RealPicksResult:
        result.message = TECHNICAL_NOTICE + ' ' + result.message
        result.limitations.insert(0, TECHNICAL_NOTICE)
        for pick in [*result.recommendations, *result.worth_the_stretch]:
            pick.limitations.insert(0, TECHNICAL_NOTICE)
        for table in result.meal_combinations:
            table.limitations.insert(0, TECHNICAL_NOTICE)
        return result


class LocalValidationDietPolicy:
    """Apply the owner-approved soft-diet test only when both named diets are active."""
    def __init__(self): self.applied = False

    def prepare(self, request: RealPicksRequest) -> RealPicksRequest:
        active = set(request.profile.dietary_restrictions) | set(request.constraints.dietary_restrictions)
        self.applied = {DietaryRestriction.no_beef, DietaryRestriction.no_pork} <= active
        return TechnicalDietTestPolicy().prepare(request) if self.applied else request

    def label(self, result: RealPicksResult) -> RealPicksResult:
        return TechnicalDietTestPolicy().label(result) if self.applied else result


TECHNICAL_SYSTEM = SYSTEM + """
For this single technical evaluation only, dietary restrictions supplied in
technical_soft_dietary_preferences are soft preferences, never verified safety.
The user reports avoiding beef and pork. Python has excluded items explicitly
naming beef or pork. Treat any other dislikes only as stated in the supplied
profile. General culinary knowledge may guide
tentative ranking, but never convert an inferred ingredient or absence into a
menu fact or verified dietary claim. The menu is user-supplied, not official.
Return fewer or no candidates when the source text cannot support a strong fit.
"""


class _TechnicalContext:
    def __init__(self, context): self.context = context
    @property
    def has_candidates(self): return self.context.has_candidates
    @property
    def digest(self): return self.context.digest
    def wire(self):
        wire = self.context.wire()
        wire['technical_test_preferences'] = {'avoid': ['beef', 'pork'],
            'basis': 'user reported for this one test; not verified menu composition'}
        return wire


class TechnicalTestMetaProvider:
    def __init__(self, *, milestone='4D.5A', budget=None):
        self.client = MetaCulinaryProvider(milestone=milestone, budget=budget,
                                           consent=LiveConsent(live=True, confirm_spend=True))

    def propose(self, context):
        technical = bool(context.request._technical_soft_dietary)
        mode, model, proposal = self.client.complete(_TechnicalContext(context) if technical else context,
            TECHNICAL_SYSTEM if technical else SYSTEM, RealCulinaryProposal)
        return RealProviderOutput(mode=mode, model=model, proposal=proposal)


class OneShotProvider:
    def __init__(self, factory):
        self.factory, self.lock, self.attempted = factory, Lock(), False

    def propose(self, context):
        with self.lock:
            if self.attempted:
                raise CulinaryError('attempt_limit', 'This approved one-call test has already been attempted. No second model request was made.')
            self.attempted = True
        return self.factory().propose(context)


def bind_approved_user(app, user_id: UUID, provider: OneShotProvider, policy=None):
    """Runner-only dependency overrides; the normal FastAPI app stays disabled."""
    def scoped_provider(user: UserIdentity = Depends(get_user)):
        if user.user_id != user_id:
            raise HTTPException(status_code=403, detail='This local test is reserved for one verified guest identity.')
        return provider

    app.dependency_overrides[routes.get_provider] = scoped_provider
    if policy is not None:
        app.dependency_overrides[routes.get_request_policy] = lambda: policy
    app.dependency_overrides[routes.get_capability] = lambda: RealPicksCapability(available=True, mode='meta',
        message=('One approved technical-only Muse Spark test is available. Dietary suitability is unverified; do not order from these results.'
                 if policy is not None else 'One approved local Muse Spark test is available for the selected guest. No automatic retries.'))
