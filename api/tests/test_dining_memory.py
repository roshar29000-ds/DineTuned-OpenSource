"""Offline HTTP tests. No hosted database or model requests."""
import json
from uuid import UUID
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.persistence.auth import UserIdentity
from app.persistence.config import PersistenceError
from app.persistence.models import DiningEventWrite, DishFeedbackWrite
from app.persistence.repository import SupabaseMemoryRepository
from app.persistence.routes import get_client
from test_persistence import A, B, ROW, KEY, TOKEN, CONFIG, NOW

H = '44444444-4444-4444-8444-444444444444'
F = '55555555-5555-4555-8555-555555555555'
WRITE = dict(id=ROW, event_type='saved', restaurant_id='casa-sol', menu_version='v1', dish_id='taco', restaurant_name='Casa Sol', dish_name='Taco', occurred_at=NOW, recommendation_id=None)
META = dict(user_id=A, created_at=NOW, updated_at=NOW, source='user_reported')
FEEDBACK = dict(id=F, event_id=ROW, rating=5, tags=['great_texture'], feedback=dict(id='original-rating', restaurant_id='casa-sol', restaurant_name='Casa Sol', menu_version='v1', dish_id='taco', dish_name='Taco', date=NOW, liked=True, note='Loved the smoky flavor but disliked the sweetness'))


def repository(callback):
    return SupabaseMemoryRepository(httpx.Client(transport=httpx.MockTransport(callback)), CONFIG, UserIdentity(UUID(A), True, TOKEN))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', CONFIG.url)
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', KEY)
    yield TestClient(app)
    app.dependency_overrides.pop(get_client, None)


def wire(callback):
    def respond(request):
        if request.url.path == '/auth/v1/user': return httpx.Response(200, json={'id': A, 'role': 'authenticated', 'is_anonymous': True})
        assert request.headers['authorization'] == 'Bearer ' + TOKEN
        if request.method != 'POST': assert request.url.params['user_id'] == 'eq.' + A
        return callback(request)
    app.dependency_overrides[get_client] = lambda: httpx.Client(transport=httpx.MockTransport(respond))


@pytest.mark.parametrize('kind', ['saved','selected','ordered','tasted'])
def test_each_action_is_distinct_and_records_names(client, kind):
    wire(lambda request: httpx.Response(201, json=[json.loads(request.content) | META | {'revision': 1}]))
    response = client.post('/api/v2/memory/events', json=WRITE | {'event_type':kind}, headers={'Authorization': 'Bearer ' + TOKEN})
    assert response.status_code == 201 and response.json()['event_type'] == kind and response.json()['dish_name'] == 'Taco'


def test_duplicate_retry_returns_original_without_overwriting():
    calls = []
    def respond(request):
        calls.append(request.method)
        return httpx.Response(409) if request.method == 'POST' else httpx.Response(200, json=[WRITE | META | {'revision': 1}])
    repo = repository(respond)
    assert str(repo.add_event(DiningEventWrite(**WRITE)).id) == ROW
    assert calls == ['POST', 'GET']
    assert repo.add_event(DiningEventWrite(**(WRITE | {'occurred_at':'2026-10-29T12:00:00Z'}))).occurred_at.isoformat().startswith('2026-10-28')
    with pytest.raises(PersistenceError) as error: repo.add_event(DiningEventWrite(**(WRITE | {'dish_id':'other'})))
    assert error.value.status == 409


def test_feedback_retry_preserves_original_notes():
    def respond(request):
        if request.url.path.endswith('/dining_events'): return httpx.Response(200, json=[WRITE | META | {'revision': 1}])
        return httpx.Response(409) if request.method == 'POST' else httpx.Response(200, json=[FEEDBACK | META | {'revision': 1}])
    repo = repository(respond)
    assert repo.add_feedback(DishFeedbackWrite(**FEEDBACK)).feedback.note == FEEDBACK['feedback']['note']
    with pytest.raises(PersistenceError): repo.add_feedback(DishFeedbackWrite(**(FEEDBACK | {'feedback': FEEDBACK['feedback'] | {'note':'different'}})))


def test_corrections_keep_provenance_and_guard_revision(client):
    observed = []
    def respond(request):
        if request.method == 'GET': return httpx.Response(200, json=[FEEDBACK | META | {'revision': 1}])
        observed.append(request)
        return httpx.Response(200, json=[FEEDBACK | META | json.loads(request.content) | {'revision': 2}])
    wire(respond)
    correction = dict(expected_revision=1, liked=False, note='Less sweet next time', rating=3, tags=['too_rich'])
    response = client.patch('/api/v2/memory/feedback/' + F, json=correction, headers={'Authorization':'Bearer '+TOKEN})
    assert response.status_code == 200 and response.json()['revision'] == 2
    assert observed[0].url.params['revision'] == 'eq.1'
    assert response.json()['feedback']['menu_version'] == 'v1' and response.json()['feedback']['id'] == 'original-rating'
    for extra in ({'user_id':B}, {'dish_id':'fake'}, {'expected_revision':0}):
        assert client.patch('/api/v2/memory/feedback/' + F, json=correction | extra, headers={'Authorization':'Bearer '+TOKEN}).status_code == 422


def test_stale_corrections_and_deletes_cannot_overwrite(client):
    wire(lambda request: httpx.Response(200, json=[] if request.method in ('PATCH','DELETE') else [WRITE | META | {'revision':2}]))
    headers = {'Authorization':'Bearer '+TOKEN}
    assert client.patch('/api/v2/memory/events/'+ROW, json={'expected_revision':1,'event_type':'ordered'},headers=headers).status_code == 409
    assert client.delete('/api/v2/memory/events/'+ROW+'?expected_revision=1',headers=headers).status_code == 409


def test_delete_is_retry_safe_and_requires_auth(client):
    wire(lambda request: httpx.Response(200, json=[]))
    url = '/api/v2/memory/events/'+ROW+'?expected_revision=1'
    assert client.delete(url).status_code == 401
    response = client.delete(url, headers={'Authorization':'Bearer '+TOKEN})
    assert response.status_code == 200 and response.json() == {'id':ROW,'deleted':True}
    assert response.headers['cache-control'] == 'private, no-store'


@pytest.mark.parametrize('kind,consumed', [('saved',False),('selected',False),('ordered',False),('tasted',True)])
def test_evidence_preserves_context_and_distinguishes_consumption(client, kind, consumed):
    history = dict(id=H, session_id='demo-session', restaurant_id='casa-sol', menu_version='v1', reported_provider='demo', dishes=[dict(id='taco',name='Taco',category_id='main',price=dict(amount_minor=1800,status='listed',currency='USD'))]) | META
    event = WRITE | META | dict(event_type=kind,recommendation_id=H,revision=1)
    def respond(request):
        if request.url.path.endswith('/dish_feedback'):
            assert request.url.params['feedback->>restaurant_id'] == 'eq.casa-sol'
            return httpx.Response(200,json=[FEEDBACK | META | {'revision':1}])
        return httpx.Response(200,json=[event if request.url.path.endswith('/dining_events') else history])
    wire(respond)
    response = client.get('/api/v2/memory/evidence?restaurant_id=casa-sol',headers={'Authorization':'Bearer '+TOKEN})
    assert response.status_code == 200
    evidence = response.json()['records'][0]
    assert evidence['consumption_confirmed'] is consumed
    assert evidence['feedback']['feedback']['note'] == FEEDBACK['feedback']['note']
    assert evidence['recommendation']['menu_version'] == 'v1'
    assert response.json()['interpretation'] == 'uninterpreted_user_reports'


def test_missing_and_foreign_evidence_is_handled_honestly(client):
    wire(lambda request: httpx.Response(200,json=[FEEDBACK | META | {'event_id':None,'revision':1}]))
    response = client.get('/api/v2/memory/evidence',headers={'Authorization':'Bearer '+TOKEN})
    assert response.status_code == 200 and response.json()['records'][0]['consumption_confirmed'] is False
    wire(lambda request: httpx.Response(200,json=[FEEDBACK | META | {'user_id':B,'revision':1}]))
    response = client.get('/api/v2/memory/evidence',headers={'Authorization':'Bearer '+TOKEN})
    assert response.status_code == 503 and B not in response.text
