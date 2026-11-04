"""Real local HTML/PDF parsing; every remote response is mocked."""
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from pathlib import Path
from uuid import uuid4
import json
import subprocess
import io
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.discovery.models import DiscoveredRestaurant, RestaurantSource
from app.discovery.config import DiscoveryError
from app.persistence import routes as memory_routes
from app.menu_sources import routes as source_routes
from app.menu_sources.agent import PublicWebsiteMenuDiscovery
from app.menu_sources.identity import SelectionProof
from app.menu_sources.limits import SourceJobLimits
from app.menu_sources.models import MenuSourceResult, MenuSourceCandidate, MenuSourceEvidence
from app.menu_extraction import routes, pdf
from app.menu_extraction.authorization import ExtractionPermit
from app.menu_extraction.html import extract_html
from app.menu_extraction.pdf import extract_pdf
from app.menu_extraction.parsing import RawItem, Block
from app.menu_extraction.parsing import currency_context, ParsedDocument
from app.menu_extraction.pipeline import MenuExtractionPipeline, ExtractionFetcher
from app.menu_extraction.models import MenuExtractionRequest, ExtractedSource
from app.menu_extraction.prices import parse_price
from app.menu_extraction.validation import MenuAssembler
from app.menu_extraction.vision import VisionProposal, VisionItemProposal

ROOT = Path(__file__).parent / 'fixtures/menu_extraction'
BASE = 'https://menus.example.org'
NOW = datetime(2026, 10, 30, tzinfo=timezone.utc)
USER = uuid4()


def identity(name='Orchard Kitchen', address='9 Oak St, Boston, MA 02108'):
    return DiscoveredRestaurant(provider='google_places', place_id='verified_branch', display_name=name,
        formatted_address=address, business_status='OPERATIONAL', types=['restaurant'],
        source=RestaurantSource(provider='google_places', api='places_new', place_id='verified_branch', retrieved_at=NOW))


def candidate(url, format_='html', parent=None):
    return MenuSourceCandidate(id='candidate_' + sha256(url.encode()).hexdigest()[:12], source_url=url,
        discovered_from=parent or url, title='Dinner menu', format=format_, menu_type='dine_in', branch_relevance='exact',
        provenance='corroborated_website', confidence='high', freshness='undated', access='checked', verified_at=NOW,
        discovered_at=NOW, suitable_for_extraction=True,
        evidence=[MenuSourceEvidence(kind='branch', source_url=parent or url, detail='Name and address corroborated during source discovery.')], limitations=[])


def request(candidates=None, restaurant=None, proof=None):
    restaurant = restaurant or identity()
    result = MenuSourceResult(request_id=uuid4(), restaurant_id=restaurant.place_id, status='sources_found', checked_at=NOW,
        candidates=candidates or [candidate(BASE+'/dinner')], requests_made=2, limitations=[])
    proof = proof or SelectionProof(b'e'*32)
    result.extraction_token = ExtractionPermit(proof).issue(restaurant, result, USER)
    return MenuExtractionRequest(request_id=uuid4(), restaurant=restaurant, selection_token=proof.issue(restaurant, USER), sources=result)


def pipeline(responses=None, vision=None, now=lambda: NOW):
    responses = {BASE+'/robots.txt': (200, 'text/plain', b'User-agent: *\nAllow: /'),
                 BASE+'/dinner': (200, 'text/html', (ROOT/'orchard-menu.html').read_bytes()), **(responses or {})}
    calls = []
    def mock(req):
        calls.append(req)
        assert 'authorization' not in req.headers and 'cookie' not in req.headers and 'x-goog-api-key' not in req.headers
        assert req.method == 'GET'
        value = responses.get(str(req.url), (404, 'text/plain', b''))
        if isinstance(value, Exception): raise value
        status, mime, body, *headers = value
        return httpx.Response(status, headers={'Content-Type': mime, **(headers[0] if headers else {})}, stream=httpx.ByteStream(body))
    client = httpx.Client(transport=httpx.MockTransport(mock), trust_env=False)
    return MenuExtractionPipeline(ExtractionFetcher(client, sleep=lambda _: None), vision, now), calls


def pdf_setup(file='cedar-three-pages.pdf', vision=None):
    home = b'<html><title>Cedar &amp; Salt</title><address>123 North River Street, Chicago, IL 60607</address><a href="/dinner.pdf">Dinner menu</a></html>'
    run, calls = pipeline({BASE+'/': (200,'text/html',home), BASE+'/dinner.pdf': (200,'application/pdf',(ROOT/file).read_bytes())}, vision)
    return run, request([candidate(BASE+'/dinner.pdf','pdf',BASE+'/')],identity('Cedar & Salt','123 N River St, Chicago, IL 60607')), calls


def items(result): return [item for category in result.menu.categories for item in category.items]


@pytest.mark.parametrize('file,name,address,count,categories', [
    ('orchard-menu.html','Orchard Kitchen','9 Oak St, Boston, MA 02108',7,3),
    ('harbor-menu.html','Harbor Table','80 Bay Road, Miami, FL 33101',6,3),
    ('lantern-menu.html','Lantern Noodle','456 NW Ash Ave, Portland, OR 97209',4,2),
    ('currencies-menu.html','Orchard Kitchen','9 Oak St, Boston, MA 02108',6,1),
])
def test_diverse_html_layouts_keep_all_records_and_field_evidence(file,name,address,count,categories):
    body=(ROOT/file).read_bytes(); run,calls=pipeline({BASE+'/dinner':(200,'text/html',body)})
    result=run.extract(request(restaurant=identity(name,address)))
    assert result.menu.total_items == count and len(result.menu.categories) == categories
    assert result.menu.sources[0].source_hash == sha256(body).hexdigest()
    assert result.menu.sources[0].retrieved_at == NOW and result.requests_made == len(calls)
    assert result.menu.completeness.restaurant_menu_complete is False and result.menu.recommendations_ready is False
    refs={e.id:e for e in result.menu.evidence}
    for item in items(result):
        assert all(ref in refs for ref in item.evidence_ids)
        assert item.ingredients == item.dietary == []
        assert item.allergens.information_status == item.allergens.cross_contact == 'unknown'
        assert item.availability == 'unverified'
        assert all(p.evidence_id in refs for p in item.price.options)
    assert all(e.source_url == BASE+'/dinner' and e.source_hash == sha256(body).hexdigest() for e in refs.values())
    assert not any('gift' in item.name.casefold() for item in items(result))


def test_structured_variants_missing_prices_and_html_table_variants_are_preserved():
    run,_=pipeline(); result=run.extract(request()); by_name={i.name:i for i in items(result)}
    assert by_name['Garden leaves'].price.options[0].amount_minor == 1450
    assert by_name['Market fish'].price.kind == 'unknown'
    ice=by_name['Vanilla ice cream'].price
    assert ice.kind == 'variants' and not ice.budget_usable
    assert [(o.label,o.amount_minor,o.currency) for o in ice.options] == [('Small',500,'USD'),('Large',800,'USD')]
    run,_=pipeline({BASE+'/dinner':(200,'text/html',(ROOT/'harbor-menu.html').read_bytes())})
    cold=next(i for i in items(run.extract(request(restaurant=identity('Harbor Table','80 Bay Road, Miami, FL 33101')))) if i.name=='Cold brew')
    assert [(p.label,p.amount_minor) for p in cold.price.options] == [('Small',400),('Large',600)]


@pytest.mark.parametrize('raw,currency,kind,amounts,currencies', [
    ('USD 18.99',None,'fixed',[1899],['USD']), ('€14,50',None,'fixed',[1450],['EUR']),
    ('JPY 1200',None,'fixed',[1200],['JPY']), ('KWD 3.250',None,'fixed',[3250],['KWD']),
    ('$5',None,'ambiguous',[None],[None]), ('$5','CAD','fixed',[500],['CAD']),
    ('USD 18–24',None,'range',[1800,2400],['USD','USD']), ('Small USD 12 / Large USD 18',None,'variants',[1200,1800],['USD','USD']),
    ('USD 18 / EUR 17',None,'variants',[1800,1700],['USD','EUR']), ('12,50','USD','fixed',[1250],['USD']),
    ('1.000','KWD','fixed',[1000],['KWD']), ('12.345','USD','ambiguous',[None],['USD']),
    ('12.5','USD','fixed',[1250],['USD']), ('10.0','USD','fixed',[1000],['USD']),
    ('KWD 3.2',None,'fixed',[3200],['KWD']),
])
def test_exact_price_transcription(raw,currency,kind,amounts,currencies):
    value=parse_price(raw,currency,'evidence_1')
    assert value.kind == kind
    assert [o.amount_minor for o in value.options] == amounts
    assert [o.currency for o in value.options] == currencies
    assert value.budget_usable == (kind=='fixed')


@pytest.mark.parametrize('second_availability,expected', [
    ('https://schema.org/InStock', 'unverified'),
    (None, 'unverified'),
    ('https://schema.org/SoldOut', 'listed_unavailable'),
])
def test_structured_numeric_prices_and_mixed_variant_availability(second_availability, expected):
    offers = [{'price': 12.5, 'priceCurrency': 'USD', 'name': 'Small', 'availability': 'https://schema.org/SoldOut'},
              {'price': 18.0, 'priceCurrency': 'USD', 'name': 'Large', 'availability': second_availability}]
    data = {'@type': 'MenuSection', 'name': 'Mains', 'hasMenuItem': [
        {'@type': 'MenuItem', 'name': 'Vegetable bowl', 'description': 'Roasted vegetables.', 'offers': offers}]}
    body = ('<title>Orchard Kitchen</title><address>9 Oak St, Boston, MA 02108</address>'
            '<script type="application/ld+json">' + json.dumps(data) + '</script>').encode()
    run, _ = pipeline({BASE + '/dinner': (200, 'text/html', body)})
    result = run.extract(request())
    dish, = items(result)
    assert dish.availability == expected
    assert [(price.amount_minor, price.currency) for price in dish.price.options] == [(1250, 'USD'), (1800, 'USD')]
    assert dish.price.kind == 'variants' and not dish.price.budget_usable


@pytest.mark.parametrize('raw', [None,'MP','Market price','-5 USD','USD 0','USD 50000','from USD 12','USD 18 per person','USD 999999999999999999999','10%'])
def test_unknown_suspicious_or_non_dish_prices_cannot_enter_budget_checks(raw):
    assert not parse_price(raw,None,'ev_1').budget_usable


def test_real_three_page_pdf_has_all_eighteen_items_and_page_references():
    run,value,calls=pdf_setup(); result=run.extract(value)
    assert result.menu.total_items == 18 and len(result.menu.categories) == 3
    assert result.menu.sources[0].page_count == 3 and result.menu.sources[0].parsed_pages == [1,2,3]
    assert result.status == 'needs_review' and result.menu.completeness.status == 'partial'
    assert {e.page for e in result.menu.evidence} == {1,2,3}
    assert items(result)[0].price.options[0].amount_minor == 1150
    assert items(result)[-1].name == 'Fruit plate' and items(result)[-1].description.startswith('Fruit plate,')
    assert len(calls) == 3


def test_two_column_pdf_does_not_merge_dishes_or_cross_descriptions():
    run,value,_=pdf_setup('cedar-two-columns.pdf'); result=run.extract(value)
    assert result.menu.total_items == 6
    assert [c.name for c in result.menu.categories] == ['SMALL PLATES','SWEETS']
    assert all(i.description == 'Seasonal preparation.' for i in items(result))
    assert any('/column:2' in e.locator for e in result.menu.evidence)


def test_partially_scanned_pdf_preserves_readable_items_but_cannot_claim_complete():
    from pypdf import PdfReader, PdfWriter
    writer=PdfWriter(); writer.add_page(PdfReader(ROOT/'cedar-three-pages.pdf').pages[0]); writer.add_blank_page(width=612,height=792)
    buffer=io.BytesIO(); writer.write(buffer)
    value=extract_pdf(buffer.getvalue(),'Cedar & Salt')
    assert len(value.items)==6 and value.parsed_pages==[1] and value.page_count==2 and value.needs_vision
    assert not value.accounted


def test_same_street_wrong_postal_code_and_mixed_businesses_are_rejected(monkeypatch):
    import app.menu_extraction.pipeline as module
    run,value,_=pdf_setup()
    monkeypatch.setattr(module,'extract_pdf',lambda *args:ParsedDocument(identity_text='123 North River Street, Chicago, IL 99999'))
    assert run.extract(value).menu.sources[0].status=='blocked'
    content=(ROOT/'orchard-menu.html').read_bytes().replace(b'</body>',b'<script type="application/ld+json">{"@type":"Restaurant","name":"Other venue","address":{"streetAddress":"99 Other Road"}}</script></body>')
    run,_=pipeline({BASE+'/dinner':(200,'text/html',content)})
    assert run.extract(request()).status=='unavailable'


def test_menu_images_remain_explicit_vision_fallbacks():
    home=b'<html><title>Orchard Kitchen</title><address>9 Oak St, Boston, MA 02108</address><a href="/menu.png">Dinner menu</a></html>'
    run,_=pipeline({BASE+'/':(200,'text/html',home),BASE+'/menu.png':(200,'image/png',b'\x89PNG\r\n\x1a\nfixture')})
    result=run.extract(request([candidate(BASE+'/menu.png','image',BASE+'/')]))
    assert result.status=='unavailable' and result.vision_status=='unavailable' and not items(result)


def test_large_pdf_fetch_is_complete_instead_of_a_discovery_signature_sample():
    data=b'%PDF-1.7\n'+b'x'*17000
    run,_=pipeline({BASE+'/large.pdf':(200,'application/pdf',data)})
    resource=run.fetcher.fetch(BASE+'/large.pdf')
    assert resource.body==data and not resource.partial


def test_document_currency_ambiguity_and_serving_quantities_do_not_create_prices():
    assert currency_context('All prices in USD and EUR') is None
    value=parse_price('USD 18 for 2',None,'ev_1')
    assert not value.budget_usable and value.options[-1].amount_minor is None
    assert parse_price('USD 24–18',None,'ev_1').kind=='ambiguous'


def test_html_source_order_is_retained_and_unprocessed_source_set_is_partial():
    content=(ROOT/'lantern-menu.html').read_bytes()
    run,_=pipeline({BASE+'/dinner':(200,'text/html',content),BASE+'/second':(200,'text/html',content)})
    value=request([candidate(BASE+'/dinner'),candidate(BASE+'/second')],identity('Lantern Noodle','456 NW Ash Ave, Portland, OR 97209'))
    value.candidate_ids=[value.sources.candidates[0].id]
    result=run.extract(value)
    assert [c.name for c in result.menu.categories]==['Noodles','Extras']
    assert result.menu.completeness.status=='partial' and any(i.code=='unselected_sources' for i in result.menu.issues)


def test_multiple_menu_pages_deduplicate_identical_items_and_keep_all_origins():
    content=(ROOT/'orchard-menu.html').read_bytes()
    run,_=pipeline({BASE+'/second':(200,'text/html',content)})
    result=run.extract(request([candidate(BASE+'/dinner'),candidate(BASE+'/second')]))
    assert result.menu.total_items == 7 and len(result.menu.sources) == 2
    assert all(len(i.evidence_ids) >= 4 for i in items(result))
    assert any(i.code == 'duplicate_merged' for i in result.menu.issues)
    changed=content.replace(b'"24"',b'"26"')
    run,_=pipeline({BASE+'/second':(200,'text/html',changed)})
    result=run.extract(request([candidate(BASE+'/dinner'),candidate(BASE+'/second')]))
    conflicts=[i for i in items(result) if i.name=='Charred chicken']
    assert len(conflicts)==2 and all(i.confidence=='needs_review' and not i.price.budget_usable for i in conflicts)


def test_versions_are_stable_for_unchanged_content_and_change_with_source_bytes():
    run,_=pipeline(); first=run.extract(request())
    run,_=pipeline(now=lambda:NOW+timedelta(hours=1)); second=run.extract(request())
    assert first.menu.version == second.menu.version and first.menu.extracted_at != second.menu.extracted_at
    body=(ROOT/'orchard-menu.html').read_bytes().replace(b'"24"',b'"25"')
    run,_=pipeline({BASE+'/dinner':(200,'text/html',body)}); changed=run.extract(request())
    assert first.menu.version != changed.menu.version


def test_wrong_branch_changed_link_and_restricted_websites_never_produce_dishes():
    body=(ROOT/'orchard-menu.html').read_bytes().replace(b'9 Oak',b'99 Other')
    for response in [(200,'text/html',body),(403,'text/plain',b''),(302,'text/plain',b'',{'location':'https://127.0.0.1/private'})]:
        run,_=pipeline({BASE+'/dinner':response}); result=run.extract(request())
        assert result.status == 'unavailable' and not items(result)
    run,value,_=pdf_setup(); run.parents[BASE+'/']=__import__('app.menu_sources.pages',fromlist=['Page']).Page(BASE+'/')
    assert run.extract(value).status=='unavailable'
    run,calls=pipeline({BASE+'/robots.txt':(200,'text/plain',b'User-agent: *\nDisallow: /')})
    assert run.extract(request()).status=='unavailable' and len(calls)==1


def test_unknown_unsupported_vision_and_encrypted_pdf_do_not_invent_items():
    for file in ['blank-image-page.pdf','encrypted-menu.pdf']:
        run,value,_=pdf_setup(file); result=run.extract(value)
        assert result.status=='unavailable' and result.menu.total_items==0
        if file.startswith('blank'): assert result.vision_status=='unavailable' and result.menu.sources[0].status=='needs_vision'
    class MockVision:
        def propose(self, context):
            return VisionProposal(source_hash=context.source_hash,mode='mocked',items=[VisionItemProposal(name='Invented soup',page=1,transcription='Invented soup USD 12')],limitations=['Offline mock only'])
    run,value,_=pdf_setup('blank-image-page.pdf',MockVision()); result=run.extract(value)
    assert result.vision_status=='mocked' and not items(result)
    class WrongVision:
        def propose(self,context): return {'invalid':'output'}
    run,value,_=pdf_setup('blank-image-page.pdf',WrongVision()); assert run.extract(value).vision_status=='unavailable'


def test_empty_incomplete_and_javascript_only_sources_remain_honest():
    for extra in [b'<section class="menu-section"><h2>Sweets</h2></section>', b'<script>loadMoreDishes()</script>']:
        body=b'<html><title>Orchard Kitchen</title><address>9 Oak St, Boston, MA 02108</address>'+extra+b'</html>'
        run,_=pipeline({BASE+'/dinner':(200,'text/html',body)}); result=run.extract(request())
        assert result.status=='unavailable' and result.menu.completeness.status=='unknown'
    content=(ROOT/'orchard-menu.html').read_bytes().replace(b'"numberOfItems":7',b'"numberOfItems":10')
    run,_=pipeline({BASE+'/dinner':(200,'text/html',content)}); result=run.extract(request())
    assert result.menu.total_items==7 and result.menu.completeness.status=='partial'
    assert any(i.code=='declared_count_mismatch' for i in result.menu.issues)


def test_embedded_or_dynamic_content_prevents_an_accounted_source_claim():
    body=(ROOT/'lantern-menu.html').read_bytes().replace(b'</body>',b'<img src="dessert-menu.png" alt="Dessert menu"><button>Load more dishes</button></body>')
    parsed=extract_html(body)
    assert len(parsed.items)==4 and not parsed.accounted
    assert {'embedded_menu','dynamic_content'} <= {code for code,_ in parsed.issues}


def test_unsupported_fields_are_rejected_independently_of_parser_success():
    source=ExtractedSource(id='src_1',candidate=candidate(BASE+'/dinner'),source_url=BASE+'/dinner',source_hash='a'*64,status='parsed')
    assembler=MenuAssembler('branch')
    raw=RawItem('Tomato soup','Invented lobster and truffles','Starters',Block('p','Tomato soup USD 12','html'),Block('h2','Starters','html'),'USD 12')
    assert assembler.add(raw,source) is False and not assembler.items
    assert assembler.issues[0].code=='unsupported_fields'


def test_full_document_byte_limits_pdf_timeout_and_worker_environment(monkeypatch):
    run,value,calls=pdf_setup(); run.fetcher.MAX_BYTES=30
    assert run.extract(value).status=='unavailable'
    seen=[]
    def timeout(*args,**kwargs):
        seen.append(kwargs)
        raise subprocess.TimeoutExpired('offline worker',7)
    monkeypatch.setattr(subprocess,'run',timeout)
    assert pdf.read_pdf(b'%PDF-1.7') is None
    assert seen[0]['timeout']==7 and 'MODEL_API_KEY' not in seen[0]['env'] and 'GOOGLE_PLACES_API_KEY' not in seen[0]['env']


def test_manifest_rejects_stale_identity_forged_urls_expiry_and_other_users():
    clock=[1000]; proof=SelectionProof(b'p'*32,lambda:clock[0]); value=request(proof=proof); permit=ExtractionPermit(proof)
    permit.verify(value.restaurant,value.sources,USER)
    with pytest.raises(DiscoveryError): permit.verify(value.restaurant,value.sources,uuid4())
    altered=value.sources.model_copy(deep=True); altered.candidates[0].source_url='https://other.example.org/menu'
    with pytest.raises(DiscoveryError): permit.verify(value.restaurant,altered,USER)
    clock[0]+=3601
    with pytest.raises(DiscoveryError): permit.verify(value.restaurant,value.sources,USER)


def test_authenticated_extraction_reuses_source_limits_and_requires_signed_manifest(tmp_path,monkeypatch):
    monkeypatch.setenv('SUPABASE_URL','https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','sb_publishable_offline_only_12345')
    monkeypatch.setenv('GOOGLE_PLACES_ENABLED','false'); monkeypatch.setenv('GOOGLE_PLACES_LIVE_APPROVED','false')
    proof=SelectionProof(b'z'*32); value=request(proof=proof); run,calls=pipeline()
    app.dependency_overrides[source_routes.get_proof]=lambda:proof
    app.dependency_overrides[source_routes.get_limits]=lambda:SourceJobLimits(tmp_path/'jobs.db')
    app.dependency_overrides[routes.get_pipeline]=lambda:run
    app.dependency_overrides[memory_routes.get_client]=lambda:httpx.Client(transport=httpx.MockTransport(
        lambda _:httpx.Response(200,json={'id':str(USER),'role':'authenticated','is_anonymous':True})))
    try:
        client=TestClient(app); payload=value.model_dump(mode='json'); headers={'Authorization':'Bearer offline.test.signature'}
        assert client.post('/api/v2/menu-extraction/extract',json=payload).status_code==401 and not calls
        changed={**payload,'sources':{**payload['sources'],'extraction_token':None}}
        assert client.post('/api/v2/menu-extraction/extract',json=changed,headers=headers).status_code==409 and not calls
        assert client.post('/api/v2/menu-extraction/extract',json={**payload,'candidate_ids':['invented']},headers=headers).status_code==422
        assert client.post('/api/v2/menu-extraction/extract',json={**payload,'user_id':str(USER)},headers=headers).status_code==422
        result=client.post('/api/v2/menu-extraction/extract',json=payload,headers=headers)
        assert result.status_code==200 and result.json()['menu']['total_items']==7
        assert result.headers['cache-control']=='private, no-store'
        count=len(calls)
        assert client.post('/api/v2/menu-extraction/extract',json=payload,headers=headers).status_code==409 and len(calls)==count
        assert client.get('/api/v2/discovery/config').json()['google_enabled'] is False
        assert client.get('/api/v2/restaurants/verified_branch/menu').status_code==404
    finally:app.dependency_overrides.clear()


def test_discovery_to_extraction_handoff_works_without_any_paid_provider(tmp_path,monkeypatch):
    monkeypatch.setenv('SUPABASE_URL','https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','sb_publishable_offline_only_12345')
    proof=SelectionProof(b't'*32); selected=identity(); crawl,_=pipeline(); extraction,calls=pipeline()
    app.dependency_overrides[source_routes.get_proof]=lambda:proof
    app.dependency_overrides[source_routes.get_limits]=lambda:SourceJobLimits(tmp_path/'jobs.db')
    app.dependency_overrides[source_routes.get_agent]=lambda:PublicWebsiteMenuDiscovery(crawl.fetcher,now=lambda:NOW)
    app.dependency_overrides[routes.get_pipeline]=lambda:extraction
    app.dependency_overrides[memory_routes.get_client]=lambda:httpx.Client(transport=httpx.MockTransport(
        lambda _:httpx.Response(200,json={'id':str(USER),'role':'authenticated','is_anonymous':True})))
    try:
        client=TestClient(app); headers={'Authorization':'Bearer offline.test.signature'}
        context={'restaurant':selected.model_dump(mode='json'),'selection_token':proof.issue(selected,USER)}
        found=client.post('/api/v2/menu-sources/discover',json={**context,'request_id':str(uuid4()),'website_url':BASE+'/dinner'},headers=headers)
        assert found.status_code==200 and found.json()['extraction_token']
        result=client.post('/api/v2/menu-extraction/extract',json={**context,'request_id':str(uuid4()),'sources':found.json()},headers=headers)
        assert result.status_code==200 and result.json()['menu']['total_items']==7 and calls
        assert all(str(call.url).startswith(BASE) for call in calls)
    finally:app.dependency_overrides.clear()
