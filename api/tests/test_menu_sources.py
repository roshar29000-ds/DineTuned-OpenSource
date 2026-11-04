"""No external network: all sites, PDFs and identity checks use local fixtures."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import json
import socket
import httpx
import httpcore
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.discovery.models import DiscoveredRestaurant, RestaurantSource
from app.discovery.config import DiscoveryError
from app.menu_sources import routes, network
from app.menu_sources.agent import PublicWebsiteMenuDiscovery
from app.menu_sources.fetch import SourceFetcher
from app.menu_sources.identity import SelectionProof
from app.menu_sources.limits import SourceJobLimits
from app.menu_sources.models import MenuSourceRequest
from app.menu_sources.robots import RobotsPolicy
from app.menu_sources.urls import source_url, SourceBlocked
from app.persistence import routes as memory_routes

NOW = datetime(2026, 10, 29, tzinfo=timezone.utc)
USER = uuid4()
FIXTURES = Path(__file__).parent / 'fixtures/menu_sources'
BASE = 'https://cedar.example.org'
PDF = b'%PDF-1.7\nOffline signature fixture. No parsed pages.\n%%EOF'


def restaurant(name='Cedar & Salt', address='123 N River St, Chicago, IL 60607', place_id='cedar_river'):
    return DiscoveredRestaurant(provider='google_places', place_id=place_id, display_name=name,
        formatted_address=address, business_status='OPERATIONAL', types=['restaurant'],
        source=RestaurantSource(provider='google_places', api='places_new', place_id=place_id, retrieved_at=NOW))


def request(site=BASE + '/', identity=None):
    return MenuSourceRequest(request_id=uuid4(), restaurant=identity or restaurant(), selection_token='offline_proof_placeholder', website_url=site)


def html(file): return (FIXTURES / file).read_bytes()


def fixture_agent(extra=None):
    responses = {
        BASE + '/robots.txt': (200, 'text/plain', b'User-agent: *\nAllow: /'),
        BASE + '/': (200, 'text/html', html('cedar-home.html')),
        BASE + '/menus/dinner/': (200, 'text/html', html('cedar-dinner.html')),
        BASE + '/menus/dinner-2024.pdf': (200, 'application/pdf', PDF),
        'https://menus-cdn.example.org/robots.txt': (404, 'text/plain', b''),
        'https://menus-cdn.example.org/assets/dinner-2026.pdf': (200, 'application/pdf', PDF),
    }
    responses.update(extra or {})
    calls = []
    def mocked(req):
        calls.append(req)
        assert 'authorization' not in req.headers and 'cookie' not in req.headers and 'x-goog-api-key' not in req.headers
        assert req.method == 'GET' and req.headers['user-agent'] == 'DineTunedMenuDiscovery/0.1'
        item = responses.get(str(req.url), (404, 'text/plain', b''))
        if isinstance(item, Exception): raise item
        status, mime, body, *headers = item
        return httpx.Response(status, headers={'content-type': mime, **(headers[0] if headers else {})}, stream=httpx.ByteStream(body))
    client = httpx.Client(transport=httpx.MockTransport(mocked), trust_env=False)
    fetcher = SourceFetcher(client, sleep=lambda _: None)
    return PublicWebsiteMenuDiscovery(fetcher, now=lambda: NOW), calls


def test_official_website_candidate_discovers_html_pdf_and_separates_services_and_age():
    agent, calls = fixture_agent()
    result = agent.discover(request())
    assert result.status == 'sources_found' and result.menu_status == 'sources_only'
    current = {c.source_url: c for c in result.candidates}
    dinner = current[BASE + '/menus/dinner/']
    assert dinner.format == 'html' and dinner.branch_relevance == 'exact' and dinner.suitable_for_extraction
    assert dinner.discovered_from == BASE + '/' and dinner.verified_at == NOW
    pdf = current['https://menus-cdn.example.org/assets/dinner-2026.pdf']
    assert pdf.format == 'pdf' and pdf.provenance == 'linked_by_corroborated_website'
    assert pdf.suitable_for_extraction and 'Only the file signature' in ' '.join(pdf.limitations)
    assert current[BASE + '/menus/dinner-2024.pdf'].freshness == 'outdated'
    assert not current[BASE + '/menus/dinner-2024.pdf'].suitable_for_extraction
    for suffix in ['/catering-menu', '/delivery-menu']:
        assert current[BASE + suffix].access == 'not_checked'
        assert all(str(call.url) != BASE + suffix for call in calls)
    assert result.requests_made == len(calls) <= 12
    assert all('google.' not in str(call.url) and 'meta.' not in str(call.url) for call in calls)
    assert 'dishes' not in result.model_dump() and 'menu_version' not in result.model_dump()


def test_second_site_plain_html_identity_and_menu_image_without_ai():
    base = 'https://lantern.example.org'
    agent, _ = fixture_agent({base + '/robots.txt': (404, 'text/plain', b''), base + '/': (200, 'text/html', html('lantern-home.html')),
        base + '/menu': (200, 'text/html', html('lantern-menu.html')), base + '/assets/dinner-menu.png': (200, 'image/png', b'\x89PNG\r\n\x1a\nfixture')})
    result = agent.discover(request(base + '/', restaurant('Lantern Noodle', '456 NW Ash Ave, Portland, OR 97209', 'lantern')))
    assert result.status == 'sources_found'
    image = next(c for c in result.candidates if c.format == 'image')
    assert image.suitable_for_extraction and image.extraction_status == 'not_extracted'


def test_single_visible_footer_address_can_corroborate_branch_without_address_tag():
    home = b'''<html><title>Cedar &amp; Salt Chicago</title><div class="contact">123 N River St, Chicago, IL 60607</div>
      <a href="/menus/dinner/">Dinner menu</a></html>'''
    menu = b'<html><h1>Dinner menu</h1><p>Current dishes</p></html>'
    agent, _ = fixture_agent({BASE + '/': (200, 'text/html', home), BASE + '/menus/dinner/': (200, 'text/html', menu)})
    result = agent.discover(request())
    candidate = next(c for c in result.candidates if c.source_url == BASE + '/menus/dinner/')
    assert candidate.branch_relevance == 'exact' and candidate.suitable_for_extraction
    assert any(e.kind == 'branch' and 'Visible page text' in e.detail for e in candidate.evidence)


def test_visible_multi_branch_footer_or_wrong_street_never_corroborates_menu():
    for extra in [b'<div>90 Oak St, Chicago, IL 60607</div>', b'']:
        home = (b'<html><title>Cedar &amp; Salt Chicago</title><div>999 Lake St, Chicago, IL 60607</div>'
                + extra + b'<a href="/menus/dinner/">Dinner menu</a></html>')
        agent, _ = fixture_agent({BASE + '/': (200, 'text/html', home),
                                  BASE + '/menus/dinner/': (200, 'text/html', b'<html><h1>Dinner menu</h1></html>')})
        result = agent.discover(request())
        candidate = next(c for c in result.candidates if c.source_url == BASE + '/menus/dinner/')
        assert candidate.branch_relevance != 'exact' and not candidate.suitable_for_extraction
    group = (b'<html><title>Cedar &amp; Salt Chicago</title><div>123 N River St, Chicago, IL 60607</div>'
             b'<div>90 Oak St, Chicago, IL 60607</div><a href="/menus/dinner/">Dinner menu</a></html>')
    agent, _ = fixture_agent({BASE + '/': (200, 'text/html', group), BASE + '/menus/dinner/': (200, 'text/html', b'<html><h1>Dinner</h1></html>')})
    result = agent.discover(request())
    assert all(c.branch_relevance != 'exact' for c in result.candidates)


def test_local_business_json_ld_still_requires_matching_name_and_full_address():
    matched = b'''<html><title>Cedar &amp; Salt Chicago</title><script type="application/ld+json">
      {"@type":"LocalBusiness","name":"Cedar & Salt","address":{"streetAddress":"123 N River St",
      "addressLocality":"Chicago","postalCode":"60607"}}</script><a href="/menus/dinner/">Dinner menu</a></html>'''
    agent, _ = fixture_agent({BASE + '/': (200, 'text/html', matched),
                              BASE + '/menus/dinner/': (200, 'text/html', b'<html><h1>Dinner menu</h1></html>')})
    result = agent.discover(request())
    candidate = next(c for c in result.candidates if c.source_url == BASE + '/menus/dinner/')
    assert candidate.branch_relevance == 'exact' and candidate.suitable_for_extraction
    wrong = matched.replace(b'123 N River St', b'999 Lake St')
    agent, _ = fixture_agent({BASE + '/': (200, 'text/html', wrong),
                              BASE + '/menus/dinner/': (200, 'text/html', b'<html><h1>Dinner menu</h1></html>')})
    result = agent.discover(request())
    assert all(not c.suitable_for_extraction for c in result.candidates)


def test_group_site_menu_links_remain_scoped_to_exact_branch():
    agent, calls = fixture_agent({BASE + '/': (200, 'text/html', html('group.html')),
        'https://menus-cdn.example.org/boston-dinner.pdf': (200, 'application/pdf', PDF),
        BASE + '/generic-menu': (200, 'text/html', b'<html><h1>Menu for all locations</h1></html>')})
    result = agent.discover(request(identity=restaurant('Orchard Kitchen', '9 Oak St, Boston, MA 02108', 'orchard_boston')))
    assert result.status == 'sources_found'
    chosen = next(c for c in result.candidates if c.id == result.recommended_candidate_id)
    assert chosen.source_url.endswith('boston-dinner.pdf')
    assert not any(str(c.url).endswith('chicago-menu.pdf') for c in calls)
    generic = next(c for c in result.candidates if c.source_url.endswith('/generic-menu'))
    assert not generic.suitable_for_extraction


def test_wrong_branch_unknown_address_and_contradictory_menu_never_qualify():
    for identity in [restaurant(address='999 North Lake St, Chicago, IL 60607'), restaurant(address=None)]:
        agent, _ = fixture_agent()
        result = agent.discover(request(identity=identity))
        assert result.recommended_candidate_id is None
        assert all(not c.suitable_for_extraction for c in result.candidates)
    agent, _ = fixture_agent({BASE + '/menus/dinner/': (200, 'text/html', b'<html><title>Cedar &amp; Salt Dinner Menu</title><address>999 Lake Road, Boston, MA 02108</address></html>')})
    result = agent.discover(request())
    assert next(c for c in result.candidates if c.source_url == BASE + '/menus/dinner/').branch_relevance == 'other_branch'


def test_linked_different_business_does_not_inherit_parent_identity():
    page = b'<html><script type="application/ld+json">{"@type":"Restaurant","name":"Another Business","address":{"streetAddress":"9 Other Road"}}</script><h1>Dinner menu</h1></html>'
    agent, _ = fixture_agent({BASE + '/menus/dinner/': (200, 'text/html', page)})
    result = agent.discover(request())
    candidate = next(c for c in result.candidates if c.source_url == BASE + '/menus/dinner/')
    assert candidate.branch_relevance == 'other_branch' and not candidate.suitable_for_extraction


@pytest.mark.parametrize('rules,path,allowed', [
    ('User-agent: *\nDisallow: /private\nAllow: /private/menu', '/private/menu', True),
    ('User-agent: *\nDisallow: /*.pdf$', '/dinner.pdf', False),
    ('User-agent: *\nDisallow: /*.pdf$', '/dinner.pdf?download=1', True),
    ('User-agent: *\nDisallow: /\nUser-agent: DineTunedMenuDiscovery\nAllow: /menu', '/menu', True),
    ('User-agent: *\nDisallow: /\nUser-agent: OtherBot\nDisallow:\nUser-agent: DineTunedMenuDiscovery\nDisallow: /private', '/private', False),
    ('User-agent: DineTunedMenuDiscovery\nDisallow: /menu\nUser-agent: DineTunedMenuDiscovery\nAllow: /menu', '/menu', True),
    ('User-agent: *\nDisallow: /%6denu', '/menu', False),
    ('User-agent: *\nDisallow: /*?private=*', '/menu?private=1', False),
])
def test_robots_rules(rules, path, allowed):
    assert RobotsPolicy.parse(rules).allows(BASE + path) is allowed


@pytest.mark.parametrize('robots', [(403, 'text/plain', b''), (429, 'text/plain', b''), (500, 'text/plain', b''),
    (200, 'text/html', b'<html>Challenge</html>'), (200, 'text/plain', b'User-agent: *\nDisallow: /'),
    (200, 'text/plain', b'User-agent: *\nCrawl-delay: 60')])
def test_robots_access_failures_do_not_fetch_restaurant_content(robots):
    agent, calls = fixture_agent({BASE + '/robots.txt': robots})
    result = agent.discover(request())
    assert result.status == 'access_limited' and not result.candidates
    assert len(calls) == 1


def test_nofollow_noai_captcha_and_external_redirects_are_respected():
    cases = [
        (200, 'text/html', b'<html><title>Site</title><meta name="robots" content="nofollow"><a href="/menu">Menu</a></html>'),
        (200, 'text/html', b'<html><meta name="robots" content="noai"><a href="/menu">Menu</a></html>'),
        (200, 'text/html', b'<html><title>Verify you are human</title></html>'),
        (302, 'text/html', b'', {'location': 'https://another.example.org/'}),
        (302, 'text/html', b'', {'location': 'http://cedar.example.org/'}),
        (302, 'text/html', b'', {'location': 'https://127.0.0.1/private'}),
    ]
    for response in cases:
        agent, calls = fixture_agent({BASE + '/': response})
        result = agent.discover(request())
        assert result.recommended_candidate_id is None and len(calls) == 2


@pytest.mark.parametrize('url', ['http://cedar.example.org/menu', 'file:///etc/passwd', 'https://localhost/menu',
    'https://127.0.0.1/menu', 'https://[::1]/menu', 'https://169.254.169.254/latest', 'https://user:pass@cedar.example.org/menu',
    'https://cedar.example.org:8443/menu', 'https://cedar.example.org/%2e%2e/private', 'https://cedar.example.org/menu?api_key=secret',
    'https://places.googleapis.com/v1/places', 'https://api.meta.ai/v1', 'https://maps.google.com/photos', 'https://google.co.uk/maps', 'https://cedar.example.org/\nmenu'])
def test_invalid_private_platform_and_credential_urls_blocked(url):
    with pytest.raises(SourceBlocked): source_url(url)


def test_dns_validation_pins_only_public_addresses_at_connection(monkeypatch):
    for addresses in [['127.0.0.1'], ['169.254.169.254'], ['10.0.0.1'], ['2606:4700::1111', '::1'], ['::ffff:8.8.8.8'], ['64:ff9b::7f00:1']]:
        monkeypatch.setattr(socket, 'getaddrinfo', lambda *args, values=addresses: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in values])
        with pytest.raises(SourceBlocked): network.public_addresses('cedar.example.org')
    calls = []
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *args: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])
    monkeypatch.setattr(httpcore.SyncBackend, 'connect_tcp', lambda _, host, port, **kwargs: calls.append((host, port)) or 'stream')
    assert network.PublicNetworkBackend().connect_tcp('cedar.example.org', 443) == 'stream'
    assert calls == [('8.8.8.8', 443)]


def test_transport_retains_verified_hostname_for_tls_and_http(monkeypatch):
    tls, connections, written = [], [], []
    class Stream(httpcore.NetworkStream):
        def read(self, max_bytes, timeout=None): return b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'
        def write(self, data, timeout=None): written.append(data)
        def close(self): pass
        def get_extra_info(self, info): return None
        def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            tls.append(server_hostname); return self
    monkeypatch.setattr(network, 'public_addresses', lambda *args: ['8.8.8.8'])
    monkeypatch.setattr(httpcore.SyncBackend, 'connect_tcp', lambda _, host, port, **kwargs: connections.append((host, port)) or Stream())
    with httpx.Client(transport=network.PublicWebTransport(), trust_env=False) as client:
        assert client.get(BASE + '/menu').text == 'ok'
    assert connections == [('8.8.8.8', 443)] and tls == ['cedar.example.org']
    assert b'Host: cedar.example.org\r\n' in b''.join(written)


def test_missing_menu_javascript_only_formats_and_timeouts_have_honest_fallback():
    for response in [(200, 'text/html', b'<html><h1>Loading</h1><script>loadMenu()</script></html>'),
                     (200, 'application/pdf', b'not a PDF'), httpx.ReadTimeout('private URL must not be echoed')]:
        agent, calls = fixture_agent({BASE + '/': response})
        result = agent.discover(request())
        assert result.recommended_candidate_id is None
        assert result.status in ('no_trustworthy_source', 'access_limited') and len(calls) == 2
        assert 'private URL' not in result.model_dump_json()


def test_advertised_sitemap_discovers_menu_but_does_not_expand_entities():
    home = b'<html><title>Restaurant</title></html>'
    agent, calls = fixture_agent({BASE + '/': (200, 'text/html', home),
        BASE + '/robots.txt': (200, 'text/plain', b'User-agent: *\nSitemap: https://cedar.example.org/sitemap.xml'),
        BASE + '/sitemap.xml': (200, 'application/xml', b'<urlset><url><loc>https://cedar.example.org/menus/dinner/</loc></url></urlset>')})
    result = agent.discover(request())
    assert result.status == 'sources_found' and any('sitemap.xml' in str(c.url) for c in calls)
    agent, _ = fixture_agent({BASE + '/': (200, 'text/html', home),
        BASE + '/robots.txt': (200, 'text/plain', b'User-agent: *\nSitemap: https://cedar.example.org/sitemap.xml'),
        BASE + '/sitemap.xml': (200, 'application/xml', b'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><urlset>&a;</urlset>')})
    assert agent.discover(request()).status == 'access_limited'


def test_response_size_request_budget_and_date_evidence_are_bounded():
    agent, calls = fixture_agent({BASE + '/': (200, 'text/html', b'<html>' + b'x' * 800000)})
    result = agent.discover(request()); assert result.status == 'access_limited' and len(calls) == 2
    agent, calls = fixture_agent(); agent.fetcher.MAX_REQUESTS = 2
    result = agent.discover(request()); assert len(calls) == 2 and not any(c.suitable_for_extraction for c in result.candidates)
    from app.menu_sources.agent import dated_menu
    assert dated_menu('Dinner menu', BASE + '/uploads/2020/dinner.pdf', 2026) == ('undated', None)
    assert dated_menu('Dinner menu 2024', BASE + '/dinner.pdf', 2026) == ('outdated', '2024')


def test_selection_proof_rejects_tampering_other_users_expiry_and_foreign_identity():
    clock = [1000]; proof = SelectionProof(b'x' * 32, lambda: clock[0]); r = restaurant()
    token = proof.issue(r, USER); proof.verify(token, r, USER)
    assert r.display_name not in token and str(USER) not in token
    for value, identity, owner in [(token + 'x', r, USER), (token, restaurant(address='Other address'), USER), (token, r, uuid4())]:
        with pytest.raises(DiscoveryError): proof.verify(value, identity, owner)
    clock[0] += 3601
    with pytest.raises(DiscoveryError): proof.verify(token, r, USER)
    proof.verify(token, r, USER, grace_seconds=5 * 3600)
    for identity, owner in [(restaurant(address='Other address'), USER), (r, uuid4())]:
        with pytest.raises(DiscoveryError): proof.verify(token, identity, owner, grace_seconds=5 * 3600)
    clock[0] = 1000 + 6 * 3600
    with pytest.raises(DiscoveryError): proof.verify(token, r, USER, grace_seconds=5 * 3600)


@pytest.mark.parametrize('signing_available', [True, False])
def test_places_selection_issues_owner_bound_proof_without_an_extra_lookup(monkeypatch, signing_available):
    from app.discovery import routes as discovery_routes
    from app.discovery.models import MenuDiscoveryHandoff
    from app.discovery.config import PlacesConfig
    monkeypatch.setenv('SUPABASE_URL', 'https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_offline_only_12345')
    proof = SelectionProof(b'z' * 32); identity = restaurant(); calls = []
    def get_signer():
        if not signing_available: raise DiscoveryError(503, 'Local key unavailable')
        return proof
    monkeypatch.setattr(SelectionProof, 'local', get_signer)
    class Provider:
        def details(self, value):
            calls.append(value.place_id)
            return MenuDiscoveryHandoff(restaurant=identity, limitations=[])
    class Limits:
        def reserve(self, user, token, kind, place):
            assert user == USER and kind == 'details' and place == identity.place_id
    app.dependency_overrides[discovery_routes.get_config] = lambda: PlacesConfig(True, True, 'offline_only_google_key_12345')
    app.dependency_overrides[discovery_routes.get_provider] = lambda: Provider()
    app.dependency_overrides[discovery_routes.get_limits] = lambda: Limits()
    app.dependency_overrides[memory_routes.get_client] = lambda: httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={'id': str(USER), 'role': 'authenticated', 'is_anonymous': True})))
    try:
        response = TestClient(app).post('/api/v2/discovery/selection', headers={'Authorization': 'Bearer offline.test.signature'},
            json={'session_token': str(uuid4()), 'place_id': identity.place_id})
        assert response.status_code == 200 and calls == [identity.place_id]
        handoff = MenuDiscoveryHandoff.model_validate(response.json())
        assert handoff.restaurant == identity and handoff.menu_status == 'not_retrieved'
        if signing_available: proof.verify(handoff.source_discovery_token, identity, USER)
        else: assert handoff.source_discovery_token is None and 'temporarily unavailable' in ' '.join(handoff.limitations)
    finally: app.dependency_overrides.clear()


def test_source_jobs_prevent_duplicates_and_concurrent_ownership(tmp_path):
    path = tmp_path / 'jobs.db'; job = uuid4()
    limits = SourceJobLimits(path); limits.reserve(USER, job)
    with pytest.raises(DiscoveryError): limits.reserve(USER, job)
    with pytest.raises(DiscoveryError): limits.reserve(USER, uuid4())
    limits.finish(job)
    next_job = uuid4()
    def attempt(_):
        try: SourceJobLimits(path).reserve(USER, next_job); return True
        except DiscoveryError: return False
    with ThreadPoolExecutor(max_workers=4) as executor: assert sum(executor.map(attempt, range(4))) == 1


def test_source_hourly_daily_and_active_limits_survive_new_instances(tmp_path):
    path = tmp_path / 'jobs.db'; clock = lambda: 1800000000.0
    limits = SourceJobLimits(path, clock)
    for _ in range(5):
        job = uuid4(); limits.reserve(USER, job); limits.finish(job)
    with pytest.raises(DiscoveryError, match='limit'): SourceJobLimits(path, clock).reserve(USER, uuid4())
    for _ in range(25):
        job = uuid4(); limits.reserve(uuid4(), job); limits.finish(job)
    with pytest.raises(DiscoveryError, match='limit'): SourceJobLimits(path, clock).reserve(uuid4(), uuid4())
    active = SourceJobLimits(tmp_path / 'active.db', clock)
    for _ in range(2): active.reserve(uuid4(), uuid4())
    with pytest.raises(DiscoveryError, match='limit'): active.reserve(uuid4(), uuid4())


def test_authenticated_api_requires_exact_proof_and_never_calls_google(tmp_path, monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_offline_only_12345')
    monkeypatch.setenv('GOOGLE_PLACES_ENABLED', 'false'); monkeypatch.setenv('GOOGLE_PLACES_LIVE_APPROVED', 'false')
    proof_clock = [1000]
    proof = SelectionProof(b'y' * 32, lambda: proof_clock[0]); identity = restaurant(); agent, website_calls = fixture_agent()
    data = request(); data.selection_token = proof.issue(identity, USER)
    def auth(req): return httpx.Response(200, json={'id': str(USER), 'role': 'authenticated', 'is_anonymous': True})
    app.dependency_overrides[routes.get_proof] = lambda: proof
    app.dependency_overrides[routes.get_agent] = lambda: agent
    app.dependency_overrides[routes.get_limits] = lambda: SourceJobLimits(tmp_path / 'jobs.db')
    app.dependency_overrides[memory_routes.get_client] = lambda: httpx.Client(transport=httpx.MockTransport(auth))
    try:
        client = TestClient(app); payload = data.model_dump(mode='json')
        assert client.post('/api/v2/menu-sources/discover', json=payload).status_code == 401 and not website_calls
        headers = {'Authorization': 'Bearer offline.test.signature'}
        bad = {**payload, 'restaurant': {**payload['restaurant'], 'place_id': 'wrong'}}
        assert client.post('/api/v2/menu-sources/discover', json=bad, headers=headers).status_code == 409 and not website_calls
        assert client.post('/api/v2/menu-sources/discover', json={**payload, 'user_id': str(USER)}, headers=headers).status_code == 422
        response = client.post('/api/v2/menu-sources/discover', json=payload, headers=headers)
        assert response.status_code == 200 and response.json()['status'] == 'sources_found'
        assert response.headers['cache-control'] == 'private, no-store'
        count = len(website_calls)
        assert client.post('/api/v2/menu-sources/discover', json=payload, headers=headers).status_code == 409
        assert len(website_calls) == count
        proof_clock[0] = 1000 + 2 * 3600
        late = {**payload, 'request_id': str(uuid4())}
        assert client.post('/api/v2/menu-sources/discover', json=late, headers=headers).status_code == 200
        count = len(website_calls)
        proof_clock[0] = 1000 + 6 * 3600
        expired = {**payload, 'request_id': str(uuid4())}
        assert client.post('/api/v2/menu-sources/discover', json=expired, headers=headers).status_code == 409
        assert len(website_calls) == count
        assert client.get('/api/v2/discovery/config').json()['google_enabled'] is False
    finally: app.dependency_overrides.clear()
