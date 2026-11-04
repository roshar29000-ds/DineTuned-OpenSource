const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { PlacesSearchClient, placeCategory } = require('../lib/restaurants/places.ts');
const { isContract } = require('../lib/validation.ts');
const { NextRequest } = require('next/server');
const relay = require('../app/api/dinetuned/[...path]/route.ts');
const TOKEN = '11111111-1111-4111-8111-111111111111';
const SESSION = { session_token: TOKEN, expires_at: '2099-01-01T00:00:00Z', request_limit: 8 };
const RESULTS = { provider: 'google_places', session_token: TOKEN, location_mode: 'global', predictions: [
  { provider: 'google_places', place_id: 'north', name: 'Test Cafe', address: null, types: [], distance_meters: null },
] };
const HANDOFF = { schema_version: 1, menu_status: 'not_retrieved', limitations: ['Menu discovery is not connected.'], restaurant: {
  provider: 'google_places', place_id: 'north', display_name: 'Test Cafe', formatted_address: 'North Street', location: null,
  business_status: 'UNKNOWN', types: ['cafe'], attributions: [], source: { provider: 'google_places', api: 'places_new', place_id: 'north', retrieved_at: '2026-10-29T12:00:00Z' },
} };
const INPUT = { query: 'Cafe', area: '', location: null };
function mockFetch(t, handler) {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); global.fetch = handler;
}
function response(data, status = 200) { return new Response(JSON.stringify(data), { status }); }

test('typed identity requires real provenance; no menu or demo fields are accepted', () => {
  assert.ok(isContract('MenuDiscoveryHandoff', HANDOFF));
  for (const value of [{ ...HANDOFF, menu: [] }, { ...HANDOFF, menu_status: 'ready' }, { ...HANDOFF, restaurant: { ...HANDOFF.restaurant, is_demo: true } }]) {
    assert.equal(isContract('MenuDiscoveryHandoff', value), false);
  }
  assert.equal(placeCategory(['food', 'korean_restaurant']), 'korean restaurant');
  assert.equal(placeCategory([]), 'Category unavailable');
});

test('one token across concurrent predictions; fresh auth per request; no keys or user ID in payload', async t => {
  const calls = []; let auth = 0;
  mockFetch(t, async (url, init) => { calls.push({ url, init }); return response(url.endsWith('/sessions') ? SESSION : RESULTS); });
  const client = new PlacesSearchClient(async () => { auth++; return 'offline.test.signature'; });
  await Promise.all([client.search(INPUT, new AbortController().signal), client.search({ ...INPUT, query: 'Cafes' }, new AbortController().signal)]);
  assert.equal(calls.filter(c => c.url.endsWith('/sessions')).length, 1); assert.equal(auth, 3);
  for (const c of calls) {
    assert.equal(c.init.headers.Authorization, 'Bearer offline.test.signature'); assert.equal(c.init.cache, 'no-store');
    assert.ok(!c.init.body.includes('user_id')); assert.ok(!c.init.body.includes('api_key'));
  }
  assert.equal(JSON.parse(calls[1].init.body).session_token, TOKEN);
});

test('minimum input, expired session and aborted queries do not send autocomplete', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return response({ ...SESSION, expires_at: '2000-01-01T00:00:00Z' }); });
  const client = new PlacesSearchClient(async () => 'offline.test.signature');
  await assert.rejects(client.search({ ...INPUT, query: 'Ca' }, new AbortController().signal), /3 characters/);
  assert.equal(calls, 0);
  await assert.rejects(client.search(INPUT, new AbortController().signal), /session ended/);
  assert.equal(calls, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.search(INPUT, abort.signal));
  assert.equal(calls, 1);
});

test('only explicit restart or a different query rotates consumed sessions; mismatched identity is rejected', async t => {
  let creates = 0, wrong = false, token = TOKEN;
  mockFetch(t, async (url) => {
    if (url.endsWith('/sessions')) { creates++; token = TOKEN.slice(0, -1) + creates; return response({ ...SESSION, session_token: token }); }
    if (url.endsWith('/selection')) return response(wrong ? { ...HANDOFF, restaurant: { ...HANDOFF.restaurant, place_id: 'south' } } : HANDOFF);
    return response({ ...RESULTS, session_token: token });
  });
  const client = new PlacesSearchClient(async () => 'offline.test.signature'), signal = new AbortController().signal;
  await client.search(INPUT, signal);
  assert.equal((await client.select('north', token, signal)).restaurant.place_id, 'north');
  await assert.rejects(client.search(INPUT, signal), /session ended/); assert.equal(creates, 1);
  await client.search({ ...INPUT, query: 'Different' }, signal); assert.equal(creates, 2);
  client.reset(); await client.search(INPUT, signal); assert.equal(creates, 3);
  wrong = true; await assert.rejects(client.select('north', token, signal), /did not match/);
});

test('provider failure is surfaced once; stale or fictional search envelopes rejected', async t => {
  for (const bad of [null, { ...RESULTS, provider: 'demo' }, { ...RESULTS, session_token: '22222222-2222-4222-8222-222222222222' }]) {
    let predictions = 0;
    mockFetch(t, async url => {
      if (url.endsWith('/sessions')) return response(SESSION);
      predictions++; return bad ? response(bad) : response({ detail: 'Search has reached its request limit.' }, 429);
    });
    const client = new PlacesSearchClient(async () => 'offline.test.signature');
    await assert.rejects(client.search(INPUT, new AbortController().signal));
    assert.equal(predictions, 1);
  }
});

test('relay requires auth, refuses cross-origin paid POST, forwards auth only to server', async t => {
  let requests = 0;
  mockFetch(t, async (_, init) => { requests++; assert.equal(init.headers.Authorization, 'Bearer offline.test.signature'); return response(RESULTS); });
  const context = { params: Promise.resolve({ path: ['discovery', 'autocomplete'] }) };
  const url = 'http://localhost:3000/api/dinetuned/discovery/autocomplete';
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}' }), context)).status, 401);
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature', Origin: 'https://other.example' } }), context)).status, 403);
  assert.equal(requests, 0);
  const result = await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature' } }), context);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'private, no-store'); assert.equal(requests, 1);
});

test('identical searches share in-flight work and settled results across unmount/abort and refresh', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const calls = [];
  mockFetch(t, async url => {
    calls.push(url);
    if (url.endsWith('/sessions')) return response(SESSION);
    await wait; return response(RESULTS);
  });
  const client = new PlacesSearchClient(async () => 'offline.test.signature'); t.after(() => client.dispose());
  const first = new AbortController();
  const one = client.search(INPUT, first.signal);
  const rejected = assert.rejects(one, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  first.abort(); // Hook unmounts after issuing the request.
  const two = client.search(INPUT, new AbortController().signal);
  release(); await rejected; assert.deepEqual(await two, RESULTS);
  assert.deepEqual(await client.search({ ...INPUT, query: ' Cafe ' }, new AbortController().signal), RESULTS);
  assert.equal(calls.length, 2); // Exactly one local session and one autocomplete.
});

test('draft edits make no request; explicit submit keeps results across remounts and deduplicates clicks', async t => {
  const queries = []; let sessions = 0;
  mockFetch(t, async (url, options) => {
    if (url.endsWith('/sessions')) { sessions++; return response(SESSION); }
    queries.push(JSON.parse(options.body).query);
    return response(RESULTS);
  });
  const client = new PlacesSearchClient(async () => 'offline.test.signature');
  client.setDraft({ query: 'Girl' });
  client.setDraft({ query: 'Girl & the Goat', area: 'West Loop, Chicago, IL' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sessions, 0); assert.deepEqual(queries, []);
  const finished = new Promise(resolve => { const unsubscribe = client.subscribe(() => {
    if (client.getView().data) { unsubscribe(); resolve(); }
  }); });
  client.submitDraft(); client.submitDraft(); await finished;
  assert.deepEqual(queries, ['Girl & the Goat']); assert.equal(sessions, 1);
  assert.equal(client.getView().submitted.area, 'West Loop, Chicago, IL');
  assert.deepEqual(client.getView().data, RESULTS); // A remounted subscriber reads the same validated response.
  client.setDraft({ area: 'Chicago, IL' });
  assert.deepEqual(client.getView().data, RESULTS); // Editing labels, rather than deletes, prior results.
  assert.equal(sessions, 1);
  client.submitDraft();
  await new Promise(resolve => { const unsubscribe = client.subscribe(() => {
    if (client.getView().data && client.getView().submitted.area === 'Chicago, IL') { unsubscribe(); resolve(); }
  }); });
  assert.deepEqual(queries, ['Girl & the Goat', 'Girl & the Goat']); assert.equal(sessions, 2);
  client.dispose();
});

test('failed autocomplete and failed session creation are retained, never implicitly retried', async t => {
  for (const failure of ['sessions', 'autocomplete']) {
    const calls = [];
    mockFetch(t, async url => {
      calls.push(url);
      return url.endsWith('/' + failure) ? response({ detail: 'No automatic retries.' }, 503) : response(SESSION);
    });
    const client = new PlacesSearchClient(async () => 'offline.test.signature');
    const signal = new AbortController().signal;
    await assert.rejects(client.search(INPUT, signal), /No automatic retries/);
    await assert.rejects(client.search(INPUT, signal), /No automatic retries/);
    assert.equal(calls.filter(url => url.endsWith('/' + failure)).length, 1);
    client.reset(); await assert.rejects(client.search(INPUT, signal));
    assert.equal(calls.filter(url => url.endsWith('/' + failure)).length, 2);
    client.dispose();
  }
});

test('session expiry never rotates automatically, including after completed selection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  mockFetch(t, async url => { calls++; return response(url.endsWith('/sessions') ? SESSION : url.endsWith('/selection') ? HANDOFF : RESULTS); });
  const client = new PlacesSearchClient(async () => 'offline.test.signature');
  const signal = new AbortController().signal;
  await client.search(INPUT, signal); await client.select('north', TOKEN, signal);
  t.mock.timers.tick(300001);
  await assert.rejects(client.search(INPUT, signal), /session ended/);
  assert.equal(calls, 3); client.dispose();
});

test('Details coalesces rapid clicks, consumes failures and cannot be replayed after reset', async t => {
  for (const failed of [false, true]) {
    let release; const wait = new Promise(resolve => { release = resolve; });
    let details = 0;
    mockFetch(t, async url => {
      if (url.endsWith('/sessions')) return response(SESSION);
      if (url.endsWith('/autocomplete')) return response(RESULTS);
      details++; await wait; return failed ? response({ detail: 'Unavailable' }, 503) : response(HANDOFF);
    });
    const client = new PlacesSearchClient(async () => 'offline.test.signature'), signal = new AbortController().signal;
    await client.search(INPUT, signal);
    const first = client.select('north', TOKEN, signal), second = client.select('north', TOKEN, signal);
    const settled = Promise.allSettled([first, second]);
    await assert.rejects(client.select('south', TOKEN, signal), /session ended/);
    release();
    const outcomes = await settled;
    assert.equal(outcomes[0].status, failed ? 'rejected' : 'fulfilled'); assert.deepEqual(outcomes[0], outcomes[1]);
    await assert.rejects(client.select('north', TOKEN, signal), /session ended/);
    client.reset(); await assert.rejects(client.select('north', TOKEN, signal), /session ended/);
    assert.equal(details, 1); client.dispose();
  }
});

test('context changes cancel stale results; disposed identity cannot issue or expose requests', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const calls = [];
  mockFetch(t, async (url, options) => {
    calls.push(url);
    if (url.endsWith('/sessions')) return response(SESSION);
    if (!JSON.parse(options.body).area) await wait;
    return response(RESULTS);
  });
  const client = new PlacesSearchClient(async () => 'offline.test.signature'), signal = new AbortController().signal;
  const first = client.search(INPUT, signal), rejected = assert.rejects(first);
  await new Promise(resolve => setImmediate(resolve));
  await client.search({ ...INPUT, area: 'Chicago' }, signal); release(); await rejected;
  const count = calls.length;
  client.dispose();
  await assert.rejects(client.search(INPUT, signal), /session changed/);
  await assert.rejects(client.select('north', TOKEN, signal), /session changed/);
  assert.equal(calls.length, count);
});

test('edits made inside the debounce window permit a deliberate new search after selection', async t => {
  let sessions = 0;
  mockFetch(t, async url => {
    if (url.endsWith('/sessions')) { sessions++; return response(SESSION); }
    return response(url.endsWith('/selection') ? HANDOFF : RESULTS);
  });
  const client = new PlacesSearchClient(async () => 'offline.test.signature'), signal = new AbortController().signal;
  await client.search(INPUT, signal); await client.select('north', TOKEN, signal);
  client.updateInput(INPUT); // Identical remount does not rotate.
  await assert.rejects(client.search(INPUT, signal), /session ended/); assert.equal(sessions, 1);
  client.updateInput({ ...INPUT, query: 'Other' }); // Real edit, before network debounce.
  client.updateInput(INPUT);
  await client.search(INPUT, signal); assert.equal(sessions, 2); client.dispose();
});
