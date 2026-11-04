"""Offline checks for the owner-approved, runner-only technical diet evaluation."""
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import app
from app.culinary.errors import CulinaryError
from app.real_picks.context import build_context
from app.menu_extraction.upload import extract_uploaded_menu
from app.real_picks.live_gate import (TechnicalDietTestPolicy, _TechnicalContext, EXPLICIT_BEEF_PORK,
                                      OneShotProvider, bind_approved_user)
from app.real_picks.pipeline import recommend
from app.real_picks.routes import get_request_policy, _diagnose
from app.real_picks.models import RealPicksRequest
from app.schemas import Allergen, DietaryRestriction, TasteProfile, TasteAxes, DiningConstraints
from app.menu_sources.routes import get_proof
from app.menu_sources.identity import SelectionProof
from app.persistence.routes import get_user, get_repository
from app.persistence.auth import UserIdentity
from test_real_picks import fixture, mocked_provider, proposal, USER
from test_menu_upload import request as upload_request
from uuid import uuid4


def test_technical_policy_changes_only_a_request_copy_and_never_the_default_route(monkeypatch):
    monkeypatch.delenv('DINETUNED_LOCAL_TECHNICAL_TEST', raising=False)
    original = fixture()
    original.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    original.constraints.dietary_restrictions = [DietaryRestriction.no_pork]
    original.constraints.max_price_minor = 1750
    original.extraction.menu.categories[0].items[0].name = 'Pork belly'
    original.extraction.menu.categories[0].items[1].description = 'Bacon with herbs'
    assert get_request_policy(Request({'type': 'http', 'path': '/', 'headers': [], 'client': ('127.0.0.1', 0), 'server': ('127.0.0.1', 8000)})) is None
    working = TechnicalDietTestPolicy().prepare(original)
    assert working is not original and working.extraction is not original.extraction
    assert original.profile.dietary_restrictions == [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    assert original.constraints.dietary_restrictions == [DietaryRestriction.no_pork]
    assert working.profile.dietary_restrictions == [] and working.constraints.dietary_restrictions == []
    assert working.constraints.max_price_minor == 1750
    assert {original.extraction.menu.categories[0].items[i].id for i in (0, 1)} <= set(working.refinements.avoid_dish_ids)
    wire = _TechnicalContext(build_context(working)).wire()
    assert wire['technical_test_preferences']['avoid'] == ['beef', 'pork']
    assert EXPLICIT_BEEF_PORK.search('grilled prime skirt steak')
    assert not EXPLICIT_BEEF_PORK.search('hamachi agua chile')


def test_technical_policy_softens_diets_only_for_test_and_keeps_allergies_hard():
    original = fixture()
    original.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                            DietaryRestriction.gluten_free]
    original.constraints.allergies.allergens = [Allergen.milk]
    policy = TechnicalDietTestPolicy()
    working = policy.prepare(original)
    assert working.profile.dietary_restrictions == []
    assert DietaryRestriction.gluten_free in working._technical_soft_dietary
    assert '_technical_soft_dietary' not in working.model_dump()
    assert working.constraints.allergies.allergens == [Allergen.milk]
    assert 'gluten_free' in _TechnicalContext(build_context(working)).wire()['technical_soft_dietary_preferences']
    provider, calls = mocked_provider(proposal(working))
    result = policy.label(recommend(working, provider))
    assert result.status == 'no_eligible_items' and not result.recommendations and not calls
    assert result.message.startswith('TECHNICAL TEST ONLY')
    assert 'not a dietary-safe ordering recommendation' in result.limitations[0]


def test_additional_diet_is_unverified_soft_preference_only_in_technical_test():
    original = fixture()
    original.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                            DietaryRestriction.gluten_free]
    original.constraints.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    assert not build_context(original).eligible_ids
    working = TechnicalDietTestPolicy().prepare(original)
    assert working.profile.dietary_restrictions == []
    assert build_context(working).eligible_ids
    provider, calls = mocked_provider(proposal(working))
    result = TechnicalDietTestPolicy().label(recommend(working, provider))
    assert result.status == 'ready' and len(calls) == 1
    assert result.message.startswith('TECHNICAL TEST ONLY — dietary compliance has not been verified')
    assert original.profile.dietary_restrictions == [DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                                     DietaryRestriction.gluten_free]


def test_runner_diagnostic_reports_only_status_and_reason_counts(monkeypatch, caplog):
    original = fixture()
    original.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                            DietaryRestriction.gluten_free]
    original.constraints.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    original.profile.favorites = 'private favorite dish'
    working = TechnicalDietTestPolicy().prepare(original)
    assert build_context(working).eligible_ids
    provider, calls = mocked_provider(proposal(working))
    result = recommend(working, provider)
    assert result.status == 'ready' and calls
    monkeypatch.setenv('DINETUNED_REAL_PICKS_DIAGNOSTICS', '1')
    _diagnose(result)
    assert 'status=ready' in caplog.text and 'picks=3' in caplog.text
    assert 'private favorite dish' not in caplog.text
    assert all(p.dish.name not in caplog.text for p in result.recommendations)


def test_uploaded_real_menu_reaches_provider_with_full_taste_and_soft_test_diet():
    extraction = extract_uploaded_menu(upload_request())
    request = RealPicksRequest(request_id=uuid4(), extraction=extraction,
        profile=TasteProfile(complete=True, favorites='Grilled chicken with lemon; tomato soup; mushroom rice',
            axes=TasteAxes(spice=.5, richness=.4, freshness=.7, crunch=.8, aromatic=.7, sweetness=.3, umami=.8),
            dietary_restrictions=[DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                  DietaryRestriction.gluten_free]),
        constraints=DiningConstraints(max_price_minor=2500,
            dietary_restrictions=[DietaryRestriction.no_beef, DietaryRestriction.no_pork]))
    working = TechnicalDietTestPolicy().prepare(request)
    context = build_context(working)
    assert context.eligible_ids and any(p.polarity == 'like' for p in context.preferences)
    provider, calls = mocked_provider(proposal(working))
    result = recommend(working, provider)
    assert result.status == 'ready' and result.mode == 'mock' and len(result.recommendations) == 3 and len(calls) == 1
    assert request.profile.dietary_restrictions == [DietaryRestriction.no_beef, DietaryRestriction.no_pork,
                                                    DietaryRestriction.gluten_free]


def test_technical_policy_requires_stated_no_beef_and_no_pork_before_any_model_call():
    request = fixture()
    with pytest.raises(CulinaryError, match='requires both stated'):
        TechnicalDietTestPolicy().prepare(request)


def test_authenticated_one_shot_route_labels_test_and_never_repeats_model_transport():
    request = fixture()
    request.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    request.constraints.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    provider, calls = mocked_provider(proposal(request))
    class OfflineMemory:
        def evidence(self, offset=0): return []
        def events(self, offset=0): return []
    app.dependency_overrides[get_proof] = lambda: SelectionProof(b'p'*32)
    app.dependency_overrides[get_repository] = lambda: OfflineMemory()
    app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
    bind_approved_user(app, USER, OneShotProvider(lambda: provider), TechnicalDietTestPolicy())
    client = TestClient(app)
    try:
        first = client.post('/api/v2/real-picks/sessions', json=request.model_dump(mode='json'))
        assert first.status_code == 200 and first.json()['mode'] == 'mock'
        assert len(first.json()['recommendations']) == 3
        assert first.json()['message'].startswith('TECHNICAL TEST ONLY')
        assert all(p['limitations'][0].startswith('TECHNICAL TEST ONLY') for p in first.json()['recommendations'])
        assert len(calls) == 1
        second = client.post('/api/v2/real-picks/sessions', json=request.model_dump(mode='json'))
        assert second.status_code == 200 and second.json()['error_code'] == 'attempt_limit' and len(calls) == 1
        assert request.profile.dietary_restrictions == [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    finally:
        app.dependency_overrides.clear()
