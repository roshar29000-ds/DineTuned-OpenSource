const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { discoverMenuSources, publicSourceLink } = require('../lib/menu-retrieval/source-discovery.ts');
const { isContract } = require('../lib/validation.ts');
const { NextRequest } = require('next/server');
const relay = require('../app/api/dinetuned/[...path]/route.ts');
const RESULT = require('./fixtures/menu-source-result.json');
const HANDOFF = { schema_version: 1, menu_status: 'not_retrieved', limitations: [], source_discovery_token: 'offline-source-verification-token', restaurant: {
  provider: 'google_places', place_id: 'cedar_river', display_name: 'Cedar & Salt', formatted_address: '123 N River St, Chicago, IL 60607',
  location: null, business_status: 'OPERATIONAL', types: ['restaurant'], attributions: [], source: {
    provider: 'google_places', api: 'places_new', place_id: 'cedar_river', retrieved_at: '2026-10-29T12:00:00Z',
  },
} };
const signal = () => new AbortController().signal;
function mocked(t, handler) {
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); global.fetch = handler;
}

test('source results remain separate from extracted menus; optional old proof does not weaken required identity', () => {
  assert.ok(isContract('MenuSourceResult', RESULT));
  assert.equal(isContract('RestaurantMenu', RESULT), false);
  const old = structuredClone(HANDOFF); delete old.source_discovery_token;
  assert.ok(isContract('MenuDiscoveryHandoff', old));
  delete old.restaurant.place_id;
  assert.equal(isContract('MenuDiscoveryHandoff', old), false);
  assert.equal(isContract('MenuSourceResult', { ...RESULT, dishes: [] }), false);
});

test('source check sends only authenticated branch context and never Taste DNA or provider keys', async t => {
  let calls = 0;
  mocked(t, async (url, options) => {
    calls++; assert.equal(url, '/api/dinetuned/menu-sources/discover');
    assert.equal(options.headers.Authorization, 'Bearer offline.test.signature');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['request_id', 'restaurant', 'selection_token', 'website_url']);
    return Response.json(RESULT);
  });
  const result = await discoverMenuSources(HANDOFF, 'https://cedar.example.org/', RESULT.request_id, async () => 'offline.test.signature', signal());
  assert.equal(result.candidates.length, 2); assert.equal(calls, 1);
});

test('missing selection proof, unsafe URLs and cancelled checks do not dispatch', async t => {
  mocked(t, () => { assert.fail('No request should be sent'); });
  await assert.rejects(discoverMenuSources({ ...HANDOFF, source_discovery_token: null }, 'https://cedar.example.org/', RESULT.request_id, async () => '', signal()), /fresh server verification/);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://cedar.example.org/', 'https://user:pass@cedar.example.org/']) {
    assert.equal(publicSourceLink(url), null);
    await assert.rejects(discoverMenuSources(HANDOFF, url, RESULT.request_id, async () => '', signal()), /HTTPS/);
  }
  const abort = new AbortController(); abort.abort();
  await assert.rejects(discoverMenuSources(HANDOFF, 'https://cedar.example.org/', RESULT.request_id, async () => '', abort.signal));
});

test('wrong branch, stale job, malformed candidate and unsafe evidence fail closed', async t => {
  for (const change of [r => { r.restaurant_id = 'wrong'; }, r => { r.request_id = '44444444-4444-4444-8444-444444444444'; },
    r => { r.candidates[0].source_url = 'javascript:alert(1)'; }, r => { delete r.candidates[0].branch_relevance; },
    r => { r.recommended_candidate_id = 'invented'; }]) {
    const bad = structuredClone(RESULT); change(bad);
    mocked(t, async () => Response.json(bad));
    await assert.rejects(discoverMenuSources(HANDOFF, 'https://cedar.example.org/', RESULT.request_id, async () => 'offline.test.signature', signal()));
  }
});

test('provider errors are surfaced once without retries', async t => {
  let count = 0;
  mocked(t, async () => { count++; return Response.json({ detail: 'Source discovery is rate limited.' }, { status: 429 }); });
  await assert.rejects(discoverMenuSources(HANDOFF, 'https://cedar.example.org/', RESULT.request_id, async () => 'offline.test.signature', signal()), /rate limited/);
  assert.equal(count, 1);
});

test('source relay requires bearer identity and same origin; only POST is allowlisted', async t => {
  let count = 0;
  mocked(t, async (url, init) => { count++; assert.ok(url.endsWith('/api/v2/menu-sources/discover')); assert.equal(init.headers.Authorization, 'Bearer offline.test.signature'); return Response.json(RESULT); });
  const url = 'http://localhost:3000/api/dinetuned/menu-sources/discover';
  const context = { params: Promise.resolve({ path: ['menu-sources', 'discover'] }) };
  assert.equal((await relay.GET(new NextRequest(url), context)).status, 404);
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}' }), context)).status, 401);
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature', Origin: 'https://wrong.example.org' } }), context)).status, 403);
  assert.equal(count, 0);
  const response = await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature' } }), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(count, 1);
});
