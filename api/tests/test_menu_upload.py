"""User document ingestion uses local fixtures, never live websites or models."""
from base64 import b64encode
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.discovery.config import DiscoveryError
from app.discovery.models import DiscoveredRestaurant, RestaurantSource
from app.menu_extraction.models import MenuUploadRequest
from app.menu_extraction.upload import MAX_UPLOAD_BYTES, extract_uploaded_menu
from app.menu_sources.identity import SelectionProof
from app.menu_sources.limits import SourceJobLimits
from app.menu_sources.routes import get_proof, get_limits
from app.persistence.auth import UserIdentity
from app.persistence.routes import get_user
from app.real_picks.models import RealPicksRequest
from app.real_picks.pipeline import recommend
from app.real_picks.context import build_context
from app.real_picks.models import RealCulinaryProposal
from app.real_picks.provider import SYSTEM
from app.culinary.meta import MetaConfig, request_body
from app.usage_budget import MAX_REQUEST_BYTES, estimate_request
from app.schemas import TasteProfile, TasteAxes, DiningConstraints, RecommendationTasteEvidence, Allergen
from test_real_picks import mocked_provider, proposal

ROOT = Path(__file__).parent / 'fixtures/menu_extraction'
USER = uuid4()


def restaurant(name='Orchard Kitchen', address='9 Oak St, Boston, MA 02108'):
    return DiscoveredRestaurant(provider='google_places', place_id='offline_upload', display_name=name,
        formatted_address=address, business_status='OPERATIONAL', types=['restaurant'],
        source=RestaurantSource(provider='google_places', api='places_new', place_id='offline_upload',
                                retrieved_at=datetime.now(timezone.utc)))


def request(filename='orchard-menu.html', identity=None, body=None):
    data = (ROOT / filename).read_bytes() if body is None else body
    return MenuUploadRequest(request_id=uuid4(), restaurant=identity or restaurant(), selection_token='x' * 30,
                             filename=filename, content_base64=b64encode(data).decode())


def test_html_and_text_pdf_preserve_document_hash_prices_categories_and_page_evidence():
    html = extract_uploaded_menu(request())
    assert html.status == 'needs_review' and html.requests_made == 0
    assert html.menu.total_items == 7 and len(html.menu.categories) == 3
    assert html.menu.sources[0].candidate.provenance == 'user_upload'
    assert html.menu.sources[0].candidate.branch_relevance == 'unknown'
    assert html.menu.sources[0].source_hash == sha256((ROOT / 'orchard-menu.html').read_bytes()).hexdigest()
    assert html.menu.completeness.restaurant_menu_complete is False
    assert any('official origin' in issue.message for issue in html.menu.issues)
    pdf = extract_uploaded_menu(request('cedar-three-pages.pdf', restaurant('Cedar & Salt', '123 N River St, Chicago, IL 60607')))
    assert pdf.menu.total_items == 18 and len(pdf.menu.categories) == 3
    assert pdf.menu.sources[0].page_count == 3 and {e.page for e in pdf.menu.evidence if e.page} == {1, 2, 3}
    assert any(item.price.options for category in pdf.menu.categories for item in category.items)


def test_images_scanned_pdfs_bad_type_size_and_wrong_branch_do_not_invent_items():
    image = extract_uploaded_menu(request('menu.png', body=b'\x89PNG\r\n\x1a\nfixture'))
    assert image.status == 'unavailable' and image.vision_status == 'unavailable' and image.menu.total_items == 0
    scanned = extract_uploaded_menu(request('blank-image-page.pdf'))
    assert scanned.menu.total_items == 0 and scanned.vision_status == 'unavailable'
    for filename, body in [('menu.pdf', b'<html>fake PDF</html>'), ('menu.html', b'%PDF-1.7\n'),
                           ('menu.pdf', b'%PDF-' + b'x' * MAX_UPLOAD_BYTES)]:
        with pytest.raises((DiscoveryError, ValidationError)):
            extract_uploaded_menu(request(filename, body=body))
    wrong = request(body=(ROOT / 'orchard-menu.html').read_bytes().replace(b'9 Oak St', b'90 Lake St'))
    with pytest.raises(DiscoveryError, match='different restaurant or branch'):
        extract_uploaded_menu(wrong)


def test_uploaded_menu_can_ground_mocked_picks_but_never_relaxes_safety_or_budget():
    extraction = extract_uploaded_menu(request())
    req = RealPicksRequest(request_id=uuid4(), extraction=extraction,
        profile=TasteProfile(favorites='Grilled chicken with lemon; tomato soup; mushroom rice', axes=TasteAxes(freshness=.7)),
        taste_evidence=RecommendationTasteEvidence(cooking_methods=['grilled'], liked_ingredients=['mushrooms']),
        constraints=DiningConstraints(max_price_minor=2200))
    provider, calls = mocked_provider(proposal(req))
    result = recommend(req, provider)
    assert result.mode == 'mock' and len(calls) == 1 and len(result.recommendations) == 3
    assert [p.budget.overage_minor for p in result.recommendations] == [0, 0, 200]
    assert all(p.connections[0].evidence.source_url.startswith('urn:dinetuned:upload:') for p in result.recommendations)
    assert any('user-supplied' in line for line in result.limitations)
    req.constraints.allergies.allergens = [Allergen.milk]
    provider, calls = mocked_provider(proposal(req))
    blocked = recommend(req, provider)
    assert blocked.status == 'no_eligible_items' and not calls and not blocked.recommendations


def test_upload_route_requires_signed_branch_and_guest_prevents_duplicates(tmp_path):
    proof = SelectionProof(b'x' * 32)
    req = request(); req.selection_token = proof.issue(req.restaurant, USER)
    limits = SourceJobLimits(tmp_path / 'upload.sqlite3')
    app.dependency_overrides[get_proof] = lambda: proof
    app.dependency_overrides[get_limits] = lambda: limits
    client = TestClient(app)
    try:
        assert client.post('/api/v2/menu-extraction/upload', json=req.model_dump(mode='json')).status_code == 401
        app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
        response = client.post('/api/v2/menu-extraction/upload', json=req.model_dump(mode='json'))
        assert response.status_code == 200 and response.json()['menu']['total_items'] == 7
        assert response.json()['recommendation_token'] and response.json()['requests_made'] == 0
        assert client.post('/api/v2/menu-extraction/upload', json=req.model_dump(mode='json')).status_code == 409
        other = request(); other.selection_token = req.selection_token
        assert client.post('/api/v2/menu-extraction/upload', json=other.model_dump(mode='json')).status_code == 409
        app.dependency_overrides[get_user] = lambda: UserIdentity(uuid4(), True, 'offline.other.signature')
        assert client.post('/api/v2/menu-extraction/upload', json=req.model_dump(mode='json')).status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_upload_only_accepts_same_guest_signed_branch_for_one_day():
    clock = [1000]
    proof = SelectionProof(b'y' * 32, lambda: clock[0])
    selected = restaurant()
    token = proof.issue(selected, USER)
    clock[0] = 1000 + 12 * 3600
    proof.verify(token, selected, USER, grace_seconds=23 * 3600)
    with pytest.raises(DiscoveryError):
        proof.verify(token, selected, USER, grace_seconds=5 * 3600)
    with pytest.raises(DiscoveryError):
        proof.verify(token, restaurant(address='90 Lake St, Boston, MA 02108'), USER, grace_seconds=23 * 3600)
    with pytest.raises(DiscoveryError):
        proof.verify(token, selected, uuid4(), grace_seconds=23 * 3600)
    clock[0] = 1000 + 24 * 3600
    with pytest.raises(DiscoveryError):
        proof.verify(token, selected, USER, grace_seconds=23 * 3600)


def test_upload_quota_is_independent_of_website_requests(tmp_path):
    import sqlite3
    limits = SourceJobLimits(tmp_path / 'jobs.sqlite3', clock=lambda: 100_000)
    for _ in range(5):
        job = uuid4()
        limits.reserve(USER, job)
        limits.finish(job)
    with pytest.raises(DiscoveryError, match='source discovery has reached'):
        limits.reserve(USER, uuid4())
    upload = uuid4()
    limits.reserve_upload(USER, upload)
    with pytest.raises(DiscoveryError, match='upload already started'):
        limits.reserve_upload(USER, upload)
    limits.finish_upload(upload)
    with sqlite3.connect(limits.path) as db:
        assert db.execute('SELECT COUNT(*) FROM source_jobs').fetchone()[0] == 5
        assert db.execute('SELECT COUNT(*) FROM upload_jobs').fetchone()[0] == 1


def test_full_uploaded_menu_fits_one_bounded_meta_context_without_dropping_dishes():
    sections = ''.join(f'<section><h2>Section {group}</h2>' + ''.join(
        f'<article class="menu-item"><h3>Dish {group}-{n} special</h3><p>Grilled vegetables with herbs and lemon.</p><span class="price">$20.00</span></article>'
        for n in range(8 if group < 3 else 7)) + '</section>' for group in range(1, 4))
    document = ('<!doctype html><html><body><p>All prices in USD.</p>' + sections + '</body></html>').encode()
    extraction = extract_uploaded_menu(request('test-menu.html', body=document))
    assert extraction.menu.total_items == 23
    req = RealPicksRequest(request_id=uuid4(), extraction=extraction,
        profile=TasteProfile(favorites='Grilled vegetables with herbs and lemon.'),
        constraints=DiningConstraints(max_price_minor=2000))
    context = build_context(req)
    assert len(context.eligible_ids) == 23
    wire = context.wire()
    assert len(wire['sources']) == 1 and len(wire['items']) == 23
    assert all(item['source_evidence'] for item in wire['items'])
    assert all('url' not in evidence and 'source_hash' not in evidence
               for item in wire['items'] for evidence in item['source_evidence'])
    body = request_body(context, MetaConfig(), system=SYSTEM, proposal_type=RealCulinaryProposal)
    assert estimate_request(body).request_bytes <= MAX_REQUEST_BYTES
