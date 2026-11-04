"""Explicit offline browser-test app. Never imported by production app.main.

Serves real routes/parsers with in-process website/Auth responses and temporary
rate-limit state. Run only on loopback with DINETUNED_OFFLINE_BROWSER=1.
"""
import atexit
import base64
import json
import os
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

if os.environ.get('DINETUNED_OFFLINE_BROWSER') != '1':
    raise RuntimeError('This fixture app requires explicit offline browser-test mode.')
os.environ.update(SUPABASE_URL='https://offline-menu.supabase.co',
    SUPABASE_PUBLISHABLE_KEY='sb_publishable_offline_only_123456',
    GOOGLE_PLACES_ENABLED='false', GOOGLE_PLACES_LIVE_APPROVED='false', GOOGLE_PLACES_API_KEY='', MODEL_API_KEY='')

import httpx
from fastapi import Depends, HTTPException
from app.main import app
from app.discovery.models import DiscoveredRestaurant, RestaurantSource, MenuDiscoveryHandoff
from app.persistence import routes as memory
from app.menu_sources import routes as sources
from app.menu_sources.identity import SelectionProof
from app.menu_sources.limits import SourceJobLimits
from app.menu_sources.agent import PublicWebsiteMenuDiscovery
from app.menu_sources.fetch import SourceFetcher
from app.menu_extraction import routes as extraction
from app.menu_extraction.pipeline import MenuExtractionPipeline, ExtractionFetcher
from datetime import datetime, timezone


def no_network(*args, **kwargs):
    raise AssertionError('External connections are prohibited in the offline browser fixture server.')


socket.socket.connect = no_network
socket.create_connection = no_network
httpx.HTTPTransport.handle_request = no_network
httpx.AsyncHTTPTransport.handle_async_request = no_network
ROOT = Path(__file__).parent / 'fixtures/menu_extraction'
BASE = 'https://menus.example.org'
PROOF = SelectionProof(bytes(range(32)))  # Public fixture key; never the local signing key.
STATE = TemporaryDirectory(prefix='dinetuned-menu-browser-')
atexit.register(STATE.cleanup)
os.environ['DINETUNED_TABLE_STORE_PATH'] = str(Path(STATE.name) / 'guest_tables.sqlite3')
USERS = set()
CASES = {
    'orchard': ('Orchard Kitchen', '9 Oak St, Boston, MA 02108', [('dinner', 'orchard-menu.html'), ('currency-menu', 'currencies-menu.html')]),
    'cedar': ('Cedar & Salt', '123 N River St, Chicago, IL 60607', [('dinner.pdf', 'cedar-three-pages.pdf')]),
    'scanned': ('Cedar & Salt', '123 N River St, Chicago, IL 60607', [('dinner.pdf', 'blank-image-page.pdf')]),
    'empty': ('Orchard Kitchen', '9 Oak St, Boston, MA 02108', [('dinner', None)]),
    'footer': ('Orchard Kitchen', '9 Oak St, Boston, MA 02108', [('dinner', 'orchard-menu.html')]),
}


def website(request):
    assert request.method == 'GET' and request.url.host == 'menus.example.org'
    assert not any(header in request.headers for header in ('authorization', 'cookie', 'x-goog-api-key'))
    path = request.url.path
    if path == '/robots.txt':
        return httpx.Response(200, headers={'content-type': 'text/plain'}, stream=httpx.ByteStream(b'User-agent: *\nAllow: /'))
    parts = path.strip('/').split('/')
    if parts[0] not in CASES: return httpx.Response(404)
    name, address, documents = CASES[parts[0]]
    address_markup = f'<div class="location-address">{address}</div>' if parts[0] == 'footer' else f'<address>{address}</address>'
    header = f'<html><title>{name}</title>{address_markup}'
    if len(parts) == 1:
        body = (header + ''.join(f'<a href="/{parts[0]}/{slug}">{"Dinner menu" if i == 0 else "Additional menu"}</a>'
            for i, (slug, _) in enumerate(documents)) + '</html>').encode()
        mime = 'text/html'
    else:
        filename = next((file for slug, file in documents if slug == parts[1]), None)
        body = (ROOT/filename).read_bytes() if filename else (header + '<h1>Dinner menu</h1><p>Ask us about today’s menu.</p></html>').encode()
        mime = 'application/pdf' if filename and filename.endswith('.pdf') else 'text/html'
    return httpx.Response(200, headers={'content-type': mime}, stream=httpx.ByteStream(body))


def mock_auth(request):
    try:
        encoded = request.headers['authorization'].split('.')[1]
        user = UUID(json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))['sub'])
        assert user in USERS and request.url.path == '/auth/v1/user'
        return httpx.Response(200, json={'id': str(user), 'role': 'authenticated', 'is_anonymous': True})
    except (ValueError, KeyError, AssertionError): return httpx.Response(401)


def client():
    with httpx.Client(transport=httpx.MockTransport(mock_auth), trust_env=False) as value: yield value


def agent():
    with httpx.Client(transport=httpx.MockTransport(website), trust_env=False) as value:
        yield PublicWebsiteMenuDiscovery(SourceFetcher(value, sleep=lambda _: None))


def pipeline():
    with httpx.Client(transport=httpx.MockTransport(website), trust_env=False) as value:
        yield MenuExtractionPipeline(ExtractionFetcher(value, sleep=lambda _: None))


def limits(user=Depends(memory.get_user)):
    # Each browser test has its own owner/store; production caps remain unchanged.
    return SourceJobLimits(Path(STATE.name)/f'{user.user_id}.sqlite3')


app.dependency_overrides.update({sources.get_proof: lambda: PROOF, sources.get_limits: limits,
    sources.get_agent: agent, extraction.get_pipeline: pipeline, memory.get_client: client})


@app.get('/__fixtures/menu/{case}')
def fixture(case: str):
    if case not in CASES: raise HTTPException(404)
    user = uuid4(); USERS.add(user)
    name, address, _ = CASES[case]
    restaurant = DiscoveredRestaurant(provider='google_places', place_id='offline_' + case, display_name=name,
        formatted_address=address, business_status='OPERATIONAL', types=['restaurant'],
        source=RestaurantSource(provider='google_places', api='places_new', retrieved_at=datetime.now(timezone.utc), place_id='offline_' + case))
    return {'user_id': user, 'website_url': f'{BASE}/{case}/', 'handoff': MenuDiscoveryHandoff(restaurant=restaurant,
        limitations=['Offline browser fixture, not a live Google restaurant.'], source_discovery_token=PROOF.issue(restaurant, user))}

# Explicitly offline-only SDK fixture for 4D.5A. The production capability remains
# disabled; only the new browser cases opt into its mocked presentation.
from app.real_picks import routes as real_picks
from app.real_picks.provider import MetaRealMenuProvider


class OfflineTasteMemory:
    def evidence(self, offset=0): return []
    def events(self, offset=0): return []


app.dependency_overrides[memory.get_repository] = lambda: OfflineTasteMemory()


def picks_provider():
    def mock_model(request):
        payload = json.loads(request.content)
        context = json.loads(payload['messages'][1]['content'])
        by_name = {item['name']: item for item in context['items']}
        candidates = [{'item_id': by_name[name]['id'], 'fit': 'exceptional',
            'connections': [{'preference_id': 'favorites', 'field': 'description', 'quote': by_name[name]['description']}],
            'uncertainty': []} for name in ['Charred chicken', 'Mushroom rice', 'Roasted tomato soup'] if name in by_name]
        if 'lighter' in context['refinements']['preferences'] and 'Garden leaves' in by_name:
            item = by_name['Garden leaves']
            candidates.append({'item_id': item['id'], 'fit': 'exceptional',
                'connections': [{'preference_id': 'favorites', 'field': 'description', 'quote': item['description']}], 'uncertainty': []})
        pairings = []
        if all(name in by_name for name in ('Mushroom rice', 'Garden leaves', 'Lemon tart')):
            pairings = [{'main_id': by_name['Mushroom rice']['id'],
                'addition_ids': [by_name['Garden leaves']['id'], by_name['Lemon tart']['id']]}]
        proposal = {'restaurant_id': context['restaurant_id'], 'menu_version': context['menu_version'],
            'candidates': candidates, 'pairings': pairings}
        return httpx.Response(200, json={'id': 'offline-browser-model', 'object': 'chat.completion', 'created': 0,
            'model': 'muse-spark-1.3', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps(proposal)}}],
            'usage': {'prompt_tokens': 1200, 'completion_tokens': 300, 'total_tokens': 1500}})
    return MetaRealMenuProvider(mock_transport=httpx.MockTransport(mock_model))


app.dependency_overrides[real_picks.get_provider] = picks_provider
