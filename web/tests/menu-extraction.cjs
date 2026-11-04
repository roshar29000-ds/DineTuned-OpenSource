const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { extractMenuSources } = require('../lib/menu-retrieval/extraction.ts');
const { isContract } = require('../lib/validation.ts');
const { NextRequest } = require('next/server');
const relay = require('../app/api/dinetuned/[...path]/route.ts');
const fixture = require('./fixtures/menu-extraction-result.json');
const { printedAmount, extractableSource, sourcePage } = require('../lib/menu-retrieval/extracted-presentation.ts');
const handoff = { schema_version: 1, restaurant: fixture.menu.restaurant, menu_status: 'not_retrieved', limitations: [], source_discovery_token: 'offline_branch_proof_only' };
const sources = { schema_version: 1, request_id: '22222222-2222-4222-8222-222222222222', restaurant_id: handoff.restaurant.place_id,
  identity_source: 'google_places', status: 'sources_found', provider: 'bounded_public_web', seed_origin: 'user_supplied_website',
  checked_at: '2026-10-30T00:00:00Z', candidates: fixture.menu.sources.map(source => source.candidate), recommended_candidate_id: null,
  requests_made: 2, limitations: [], menu_status: 'sources_only', extraction_token: 'offline_manifest_proof_only' };
const signal = () => new AbortController().signal;
function mock(t, fn) { const previous = global.fetch; t.after(() => { global.fetch = previous; }); global.fetch = fn; }
const run = () => extractMenuSources(handoff, sources, fixture.request_id, async () => 'offline.test.signature', signal());

test('extracted menus preserve all categories and never masquerade as demo menus', () => {
  assert.ok(isContract('MenuExtractionResult', fixture));
  assert.equal(isContract('RestaurantMenu', fixture.menu), false);
  assert.equal(fixture.menu.total_items, 4);
  assert.equal(fixture.menu.completeness.restaurant_menu_complete, false);
  assert.equal(fixture.menu.recommendations_ready, false);
  for (const category of fixture.menu.categories) for (const item of category.items) {
    assert.equal(item.allergens.information_status, 'unknown'); assert.equal(item.availability, 'unverified');
  }
});

test('explicit extraction sends only verified source context with fresh authentication', async t => {
  let calls = 0;
  mock(t, async (url, init) => {
    calls++; assert.equal(url, '/api/dinetuned/menu-extraction/extract');
    assert.equal(init.headers.Authorization, 'Bearer offline.test.signature'); assert.equal(init.cache, 'no-store');
    assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['candidate_ids', 'request_id', 'restaurant', 'selection_token', 'sources']);
    return Response.json(fixture);
  });
  assert.equal((await run()).menu.total_items, 4); assert.equal(calls, 1);
});

test('missing proofs and cancellation never trigger an extraction request', async t => {
  mock(t, () => assert.fail('No request allowed'));
  await assert.rejects(extractMenuSources(handoff, { ...sources, extraction_token: null }, fixture.request_id, async () => '', signal()), /verified branch/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(extractMenuSources(handoff, sources, fixture.request_id, async () => '', abort.signal));
});

test('stale identity, duplicate items, malformed prices and missing evidence are rejected', async t => {
  for (const change of [r => { r.restaurant_id = 'other_branch'; }, r => { r.request_id = '44444444-4444-4444-8444-444444444444'; },
    r => { r.menu.categories[0].items[0].price.options[0].amount_minor = 1.5; },
    r => { r.menu.categories[0].items[0].evidence_ids = ['missing']; },
    r => { r.menu.categories[0].items.push(r.menu.categories[0].items[0]); r.menu.total_items++; },
    r => { r.menu.evidence[0].source_hash = 'f'.repeat(64); },
    r => { r.menu.sources[0].source_url = 'javascript:alert(1)'; }]) {
    const altered = structuredClone(fixture); change(altered); mock(t, async () => Response.json(altered));
    await assert.rejects(run());
  }
});

test('errors are surfaced once and cancelled responses are not accepted', async t => {
  let count = 0;
  mock(t, async () => { count++; return Response.json({ detail: 'The source permit expired.' }, { status: 409 }); });
  await assert.rejects(run(), /expired/); assert.equal(count, 1);
  const abort = new AbortController();
  mock(t, async () => { abort.abort(); return Response.json(fixture); });
  await assert.rejects(extractMenuSources(handoff, sources, fixture.request_id, async () => 'offline.test.signature', abort.signal));
});

test('extraction relay is private, same-origin and POST-only', async t => {
  let calls = 0;
  mock(t, async (url, init) => { calls++; assert.ok(url.endsWith('/api/v2/menu-extraction/extract')); assert.ok(init.headers.Authorization); return Response.json(fixture); });
  const url = 'http://localhost:3000/api/dinetuned/menu-extraction/extract';
  const context = { params: Promise.resolve({ path: ['menu-extraction', 'extract'] }) };
  assert.equal((await relay.GET(new NextRequest(url), context)).status, 404);
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}' }), context)).status, 401);
  assert.equal((await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature', Origin: 'https://foreign.example.org' } }), context)).status, 403);
  assert.equal(calls, 0);
  const result = await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer offline.test.signature' } }), context);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'private, no-store'); assert.equal(calls, 1);
});

test('explicit document selection rejects unknown and duplicate IDs before fetching', async t => {
  mock(t, () => assert.fail('Invalid selections must not send a request'));
  const id = sources.candidates[0].id;
  for (const ids of [['unknown'], [id, id], Array(9).fill(id)]) {
    await assert.rejects(extractMenuSources(handoff, sources, fixture.request_id, async () => '', signal(), ids), /distinct, eligible/);
  }
  for (const change of [{ branch_relevance: 'other_branch' }, { menu_type: 'catering' }, { freshness: 'outdated' }, { access: 'blocked' }]) {
    assert.equal(extractableSource({ ...sources.candidates[0], ...change }), false);
  }
  assert.equal(extractableSource({ ...sources.candidates[0], format: 'image' }), false);
});

test('a response must contain exactly the requested source set and an honest availability state', async t => {
  const second = { ...sources.candidates[0], id: 'second', source_url: 'https://menus.example.org/other' };
  const context = { ...sources, candidates: [...sources.candidates, second] };
  mock(t, async () => Response.json(fixture));
  await assert.rejects(extractMenuSources(handoff, context, fixture.request_id, async () => 'offline', signal(), ['second']), /did not match/);
  assert.equal((await extractMenuSources(handoff, context, fixture.request_id, async () => 'offline', signal(), [sources.candidates[0].id])).menu.total_items, 4);
  for (const change of [r => { r.status = 'unavailable'; }, r => { r.menu.sources[0].candidate.source_url += '/changed'; },
    r => { r.menu.restaurant.source.place_id = 'other'; }, r => { r.menu.sources = []; }]) {
    const bad = structuredClone(fixture); change(bad); mock(t, async () => Response.json(bad));
    await assert.rejects(run(), /did not match/);
  }
});

test('currency presentation uses exact currency scale, preserves unknown amounts and PDF page links', () => {
  const option = { label: null, raw: 'printed', evidence_id: 'ev_1', amount_minor: 1250, currency: 'USD' };
  assert.match(printedAmount(option), /USD\s+12\.50/);
  assert.match(printedAmount({ ...option, currency: 'JPY', amount_minor: 1200 }), /JPY\s+1,200/);
  assert.match(printedAmount({ ...option, currency: 'KWD', amount_minor: 3250 }), /KWD\s+3\.250/);
  assert.equal(printedAmount({ ...option, currency: null, amount_minor: null, raw: '$5' }), '$5');
  assert.equal(sourcePage('https://menus.example.org/menu.pdf#old', 3), 'https://menus.example.org/menu.pdf#page=3');
});

test('private relay accepts the exact loopback origin without trusting forwarded or foreign hosts', async t => {
  let calls = 0;
  mock(t, async () => { calls++; return Response.json(fixture); });
  const url = 'http://127.0.0.1:3126/api/dinetuned/menu-extraction/extract';
  const context = { params: Promise.resolve({ path: ['menu-extraction', 'extract'] }) };
  for (const [origin, expected] of [['http://127.0.0.1:3126', 200], ['http://localhost:3126', 403],
    ['http://127.0.0.1:3000', 403], ['https://foreign.example.org', 403], ['null', 403]]) {
    const result = await relay.POST(new NextRequest(url, { method: 'POST', body: '{}', headers: {
      Authorization: 'Bearer offline.test.signature', Host: '127.0.0.1:3126', Origin: origin,
      'X-Forwarded-Host': 'foreign.example.org',
    } }), context);
    assert.equal(result.status, expected);
  }
  assert.equal(calls, 1);
});
