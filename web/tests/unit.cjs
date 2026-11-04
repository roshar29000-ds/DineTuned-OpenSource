// A dependency-free TS loader for Node's built-in test runner. No emitted files.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } }).outputText;
  module._compile(code, filename);
};
const { restoreState, initialState } = require('../lib/storage.ts');
const { initialTaste, initialConstraints, money } = require('../lib/preferences.ts');
const { isContract } = require('../lib/validation.ts');
const { bridgeFeedback, recommendationEvidence, sessionMatchesRequest } = require('../lib/recommendations.ts');
const { visibleCategories, evaluationMatchesMenu } = require('../lib/menu.ts');
const { readableTasteBridge, withOptionalTasteBridges, bridgeFallback } = require('../lib/tastebridge.ts');
const { apiRequest } = require('../lib/api.ts');
const bridgeSession = require('./fixtures/tastebridge-session.json');

test('canonical defaults validate against generated contracts', () => {
  assert.ok(isContract('TasteProfile', initialTaste()));
  assert.ok(isContract('DiningConstraints', initialConstraints()));
});
test('invalid response shapes and unsafe prices fail runtime validation', () => {
  assert.equal(isContract('RestaurantMenu', { categories: [] }), false);
  assert.equal(isContract('DiningConstraints', { ...initialConstraints(), max_price_minor: -1 }), false);
  assert.equal(isContract('DiningConstraints', { ...initialConstraints(), max_price_minor: 1850.5 }), false);
  assert.equal(isContract('TasteProfile', { ...initialTaste(), axes: { ...initialTaste().axes, spice: 100 } }), false);
  assert.equal(isContract('DiningConstraints', { ...initialConstraints(), allergies: { allergens: ['mystery'], other: '' } }), false);
});
test('migration preserves V1 profile, exact budget and memories, never assumes menu review', () => {
  const legacy = { taste: { complete: true, favorites: 'crispy tacos', diet: 'no-pork',
    axes: { spice: 18, crunch: 89, adventure: 72 }, updatedAt: '2026-10-21T10:00:00Z' },
    budget: 18.99, mood: 'Light & fresh', selectedRestaurantId: 'saigon-table',
    feedback: [{ id: 'old-rating', restaurantName: 'Saigon Table', dishId: 'pho', dishName: 'Pho Gà',
      liked: true, note: 'Lovely broth', date: '2026-10-21T10:00:00Z', image: 'https://old-image' }] };
  const migrated = restoreState(null, JSON.stringify(legacy));
  assert.equal(migrated.taste.axes.spice, .18);
  assert.equal(migrated.taste.exploration, .72);
  assert.equal(migrated.taste.axes.sweetness, null);
  assert.equal(migrated.constraints.max_price_minor, 1899);
  assert.deepEqual(migrated.constraints.dietary_restrictions, ['no_pork']);
  assert.equal(migrated.feedback[0].note, 'Lovely broth');
  assert.equal(migrated.selection, null);
  assert.equal(migrated.taste.source, 'migrated');
});
test('corrupt storage fails closed without throwing', () => {
  assert.deepEqual(restoreState('{bad', null), initialState());
  assert.deepEqual(restoreState('null', null), initialState());
  const restored = restoreState(JSON.stringify({ version: 2, taste: { complete: true }, constraints: { max_price_minor: -50 }, feedback: [{ liked: 'yes' }] }), null);
  assert.equal(restored.taste.complete, false);
  assert.deepEqual(restored.feedback, []);
  assert.equal(restored.constraints.max_price_minor, 3000);
});
test('saved allergies survive a missing session constraint', () => {
  const state = initialState();
  state.taste.allergies = { allergens: ['peanut'], other: 'kiwi' };
  const restored = restoreState(JSON.stringify(state), null);
  assert.deepEqual(restored.constraints.allergies, { allergens: ['peanut'], other: 'kiwi' });
});
const categories = [{ id: 'soups', name: 'Soups', description: '', items: [
  { id: 'pho', name: 'Pho Gà', description: 'Chicken broth', ingredients: ['Lime'] },
  { id: 'bun', name: 'Bún Bò Huế', description: 'Beef broth', ingredients: ['Chili'] },
] }, { id: 'plates', name: 'Small plates', description: '', items: [
  { id: 'rolls', name: 'Summer rolls', description: 'Herb rolls', ingredients: ['Rice paper'] },
] }];
const evaluation = { items: [
  { item_id: 'pho', eligible: false, reasons: [] }, { item_id: 'bun', eligible: false, reasons: [] },
  { item_id: 'rolls', eligible: true, reasons: [] },
] };
test('complete menu retains every category and dish regardless of eligibility', () => {
  const visible = visibleCategories(categories, '', false, evaluation);
  assert.equal(visible.length, 2);
  assert.equal(visible.reduce((n, c) => n + c.items.length, 0), 3);
});
test('matching view uses server eligibility and never invents its own', () => {
  assert.deepEqual(visibleCategories(categories, '', true, evaluation).flatMap(c => c.items.map(d => d.id)), ['rolls']);
  assert.deepEqual(visibleCategories(categories, '', true, null), []);
});
test('menu search tolerates accents, searches ingredients, and does not mutate source', () => {
  assert.equal(visibleCategories(categories, 'bun bo hue', false, null)[0].items[0].id, 'bun');
  assert.equal(visibleCategories(categories, 'lime', false, null)[0].items[0].id, 'pho');
  assert.equal(categories[0].items.length, 2);
  assert.deepEqual(visibleCategories(categories, 'not-a-dish', false, null), []);
});
test('money preserves the chosen per-dish limit exactly', () => {
  assert.equal(money(1899), '$18.99');
  assert.equal(money(1800), '$18');
  assert.equal(money(0), '$0');
  assert.equal(money(null), 'Price unavailable');
});
test('menu eligibility is bound to the current branch, version and every session constraint', () => {
  const constraints = { ...initialConstraints(), dietary_restrictions: ['vegetarian', 'no_pork'], allergies: { allergens: ['peanut', 'milk'], other: 'kiwi' } };
  const menu = { restaurant: { id: 'branch-a' }, version: 'v1' };
  const evaluation = { restaurant_id: 'branch-a', menu_version: 'v1', constraints };
  assert.equal(evaluationMatchesMenu(evaluation, menu, constraints), true);
  assert.equal(evaluationMatchesMenu({ ...evaluation, restaurant_id: 'branch-b' }, menu, constraints), false);
  assert.equal(evaluationMatchesMenu({ ...evaluation, menu_version: 'v0' }, menu, constraints), false);
  for (const delta of [{ max_price_minor: 1899 }, { currency: 'EUR' }, { mood: 'fresh' }, { appetite: 'light' }, { dietary_restrictions: [] }, { allergies: { allergens: ['milk'], other: 'kiwi' } }, { allergies: { allergens: ['peanut', 'milk'], other: '' } }]) {
    assert.equal(evaluationMatchesMenu(evaluation, menu, { ...constraints, ...delta }), false);
  }
  assert.equal(evaluationMatchesMenu(evaluation, menu, { ...constraints, dietary_restrictions: ['no_pork', 'vegetarian'], allergies: { allergens: ['milk', 'peanut'], other: 'kiwi' } }), true);
});

const { activeSteps, choose, newDraft, restoreDraft, restoreDetective } = require('../lib/detective/model.ts');
const { demoDetective, toTasteAnswers, enrichProfile, suggestedReasons } = require('../lib/detective/engine.ts');

test('unanswered V3 dimensions remain unknown, including after the V2 adapter', () => {
  const draft = newDraft(initialTaste());
  const reading = demoDetective.analyze(draft.answers);
  assert.ok(Object.values(reading.axes).every(signal => signal.value === null && signal.confidence === 'Open'));
  assert.equal(reading.exploration, null);
  const wire = toTasteAnswers(draft.answers, reading);
  assert.ok(isContract('TasteAnswers', wire));
  const enriched = enrichProfile({ ...initialTaste(), complete: true, axes: { ...initialTaste().axes, spice: .55, crunch: .55 } }, reading);
  assert.equal(enriched.axes.spice, null);
  assert.equal(enriched.axes.crunch, null);
  assert.ok(isContract('TasteProfile', enriched));
});
test('a favorite dish suggests followups, never invents a heat preference', () => {
  const draft = choose(newDraft(initialTaste()), 'anchors', 'curry');
  assert.ok(activeSteps(draft.answers).includes('aromatics'));
  assert.ok(suggestedReasons(draft.answers).includes('fragrant'));
  assert.equal(demoDetective.analyze(draft.answers).axes.spice.value, null);
});
test('removing a branch trigger removes stale branch evidence and visited progress', () => {
  let draft = choose(newDraft(initialTaste()), 'anchors', 'ramen');
  draft = choose(draft, 'aromatics', 'spices');
  draft = { ...draft, current: 'aromatics', visited: ['aromatics'] };
  draft = choose(draft, 'anchors', 'ramen');
  assert.equal(activeSteps(draft.answers).includes('aromatics'), false);
  assert.deepEqual(draft.answers.choices.aromatics, []);
  assert.deepEqual(draft.visited, []);
  assert.equal(draft.current, 'ingredients');
  assert.equal(demoDetective.analyze(draft.answers).axes.aromatic.value, null);
});
test('direct heat preference overrides a tentative chili ingredient clue', () => {
  let draft = choose(newDraft(initialTaste()), 'ingredients', 'chili');
  assert.equal(demoDetective.analyze(draft.answers).axes.spice.confidence, 'Tentative');
  draft = choose(draft, 'heat', 'mild');
  const heat = demoDetective.analyze(draft.answers).axes.spice;
  assert.equal(heat.value, .18);
  assert.equal(heat.confidence, 'Direct');
  assert.match(heat.evidence[0], /outweighs ingredient clues/);
});
test('ingredient likes and dislikes are mutually exclusive without becoming allergies', () => {
  let draft = choose(newDraft(initialTaste()), 'ingredients', 'garlic');
  draft = choose(draft, 'avoids', 'garlic');
  assert.deepEqual(draft.answers.choices.ingredients, []);
  assert.deepEqual(draft.answers.choices.avoids, ['garlic']);
  assert.deepEqual(draft.answers.allergies, { allergens: [], other: '' });
  assert.equal(demoDetective.analyze(draft.answers).axes.aromatic.value, null);
});
test('favorite limit is enforced and a new single choice replaces the old one', () => {
  let draft = newDraft(initialTaste());
  for (const dish of ['tacos', 'ramen', 'curry', 'pasta']) draft = choose(draft, 'anchors', dish);
  assert.equal(draft.answers.choices.anchors.length, 3);
  draft = choose(choose(draft, 'heat', 'hot'), 'heat', 'mild');
  assert.deepEqual(draft.answers.choices.heat, ['mild']);
});
test('chewiness or nostalgia alone does not imply crunch or rich food', () => {
  let draft = choose(newDraft(initialTaste()), 'texture', 'chewy');
  draft = choose(draft, 'reasons', 'ritual');
  const reading = demoDetective.analyze(draft.answers);
  assert.equal(reading.axes.crunch.value, null);
  assert.equal(reading.axes.richness.value, null);
  assert.match(reading.observations[0], /not translated nostalgia/);
});
test('V3 draft and evidence survive reload while V2 profile and context remain unchanged', () => {
  const state = initialState();
  state.taste.complete = true;
  state.constraints.mood = 'cozy'; state.constraints.max_price_minor = 1899;
  const draft = choose(newDraft(state.taste), 'anchors', 'curry');
  state.detectiveDraft = { ...draft, current: 'reasons', visited: ['anchors'] };
  state.detective = { version: 3, engine: 'deterministic-v3.1', answers: draft.answers, savedAt: '2026-10-24T12:00:00Z' };
  state.tasteEdits = { axes: ['spice'], exploration: true };
  const restored = restoreState(JSON.stringify(state), null);
  assert.deepEqual(restored, state);
  assert.deepEqual(restored.taste.axes, initialTaste().axes);
});
test('malformed V3 metadata is discarded without losing a valid V2 profile', () => {
  const state = initialState(); state.taste.complete = true;
  state.detectiveDraft = { version: 3, answers: { choices: { heat: ['lava'] } } };
  const restored = restoreState(JSON.stringify(state), null);
  assert.equal(restored.detectiveDraft, null);
  assert.equal(restored.taste.complete, true);
  assert.equal(restoreDraft(null), null);
  assert.equal(restoreDetective({ version: 3, engine: 'external-ai' }), null);
});
test('preferences and allergies are carried through the unchanged V2 wire contract', () => {
  const profile = { ...initialTaste(), dietary_restrictions: ['vegetarian', 'no_pork'], allergies: { allergens: ['peanut'], other: 'kiwi' } };
  const draft = newDraft(profile), reading = demoDetective.analyze(draft.answers);
  const wire = toTasteAnswers(draft.answers, reading);
  assert.ok(isContract('TasteAnswers', wire));
  assert.deepEqual(wire.allergies, profile.allergies);
  assert.deepEqual(wire.dietary_restrictions, profile.dietary_restrictions);
  assert.equal('mood' in wire, false);
  assert.equal('max_price_minor' in wire, false);
});

const { assessMenu, qualityPolicy } = require('../lib/menu-retrieval/quality.ts');
const { safeMenuUrl, detectMenuFormat, inspectLocalFile, MAX_MENU_BYTES } = require('../lib/menu-retrieval/local-source.ts');
const { presentRestaurant, searchParameters } = require('../lib/restaurants/search.ts');
const qualityMenu = () => ({
  restaurant: { id: 'saigon-table', name: 'Saigon Table', area: 'Downtown', city: 'Chicago', item_count: 2 },
  total_items: 2, source: { kind: 'demo_fixture', completeness: 'complete_fixture', retrieved_at: null },
  categories: [{ id: 'plates', name: 'Small plates', items: [
    { id: 'a', category_id: 'plates', name: 'First dish', price: { status: 'listed', amount_minor: 1800 } },
    { id: 'b', category_id: 'plates', name: 'Second dish', price: { status: 'listed', amount_minor: 1900 } },
  ] }],
});
test('curated fixture can pass structural checks without inventing source freshness', () => {
  const result = assessMenu(qualityMenu(), 'saigon-table');
  assert.equal(result.status, 'ready');
  assert.equal(result.checks.find(check => check.id === 'freshness').result, 'not_applicable');
  assert.match(result.checks.find(check => check.id === 'source').detail, /No external retrieval/);
});
test('quality gate distinguishes missing, partial, and unknown-price menus', () => {
  const empty = qualityMenu(); empty.categories = []; empty.total_items = 0; empty.restaurant.item_count = 0;
  assert.equal(assessMenu(empty, 'saigon-table').status, 'missing');
  const partial = qualityMenu(); partial.source.completeness = 'partial';
  assert.equal(assessMenu(partial, 'saigon-table').status, 'incomplete');
  const prices = qualityMenu(); prices.categories[0].items[0].price = { status: 'unknown', amount_minor: null };
  assert.equal(assessMenu(prices, 'saigon-table').status, 'incomplete');
});
test('quality gate rejects mismatched branches, duplicate IDs, and count discrepancies', () => {
  assert.equal(assessMenu(qualityMenu(), 'another-restaurant').status, 'unreliable');
  const duplicate = qualityMenu(); duplicate.categories[0].items[1].id = 'a';
  assert.equal(assessMenu(duplicate, 'saigon-table').status, 'unreliable');
  const mismatch = qualityMenu(); mismatch.categories[0].items[0].category_id = 'wrong-category';
  assert.equal(assessMenu(mismatch, 'saigon-table').status, 'unreliable');
  const count = qualityMenu(); count.total_items = 3;
  assert.equal(assessMenu(count, 'saigon-table').status, 'incomplete');
});
test('freshness boundary is explicit and invalid or future dates fail closed', () => {
  const now = Date.parse('2026-10-24T12:00:00Z'), menu = qualityMenu();
  menu.source.retrieved_at = new Date(now - 30 * 86400000).toISOString();
  assert.equal(assessMenu(menu, 'saigon-table', undefined, qualityPolicy, now).status, 'ready');
  menu.source.retrieved_at = new Date(now - 30 * 86400000 - 1).toISOString();
  assert.equal(assessMenu(menu, 'saigon-table', undefined, qualityPolicy, now).status, 'outdated');
  menu.source.retrieved_at = new Date(now + 86400000).toISOString();
  assert.equal(assessMenu(menu, 'saigon-table', undefined, qualityPolicy, now).status, 'unreliable');
  menu.source.retrieved_at = 'not-a-date';
  assert.equal(assessMenu(menu, 'saigon-table', undefined, qualityPolicy, now).status, 'unreliable');
});
test('future external sources require provenance, a date, and an explicitly configured extraction threshold', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const evidence = { origin: 'external', sourceVerified: true, complete: true, observedAt: new Date(now).toISOString(), extractionConfidence: .95 };
  assert.equal(assessMenu(qualityMenu(), 'saigon-table', evidence, qualityPolicy, now).status, 'unreliable');
  const configured = { ...qualityPolicy, minimumExtractionConfidence: .9 };
  assert.equal(assessMenu(qualityMenu(), 'saigon-table', evidence, configured, now).status, 'ready');
  assert.equal(assessMenu(qualityMenu(), 'saigon-table', { ...evidence, sourceVerified: false }, configured, now).status, 'unreliable');
  assert.equal(assessMenu(qualityMenu(), 'saigon-table', { ...evidence, extractionConfidence: null }, configured, now).status, 'unreliable');
});
test('addresses supplement only known demo IDs and never invent an unknown restaurant', () => {
  assert.equal(presentRestaurant(qualityMenu().restaurant).address, '12 Lantern Lane, Chicago');
  assert.equal(presentRestaurant({ ...qualityMenu().restaurant, id: 'unknown' }).address, null);
  assert.equal(presentRestaurant(qualityMenu().restaurant).branch, 'Downtown');
  assert.equal(searchParameters({ query: 'Saigon', cuisine: 'All', location: null }).has('latitude'), false);
  const params = searchParameters({ query: 'Saigon', cuisine: 'Vietnamese', location: { latitude: 41.895, longitude: -87.635 } });
  assert.equal(params.get('q'), 'Saigon Vietnamese');
  assert.equal(params.get('latitude'), '41.895');
});
test('menu links accept explicit web addresses and reject executable or credential-bearing URLs', () => {
  assert.equal(safeMenuUrl(' https://example.com/menu?branch=2 '), 'https://example.com/menu?branch=2');
  for (const input of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:pass@example.com/', '/menu', 'not a link']) assert.equal(safeMenuUrl(input), null);
});
test('local menu file validation inspects bytes, media type, size, and camera image limits', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.equal(detectMenuFormat(png), 'image/png');
  assert.equal(detectMenuFormat(new TextEncoder().encode('<!doctype html><html><body>Menu</body></html>')), 'text/html');
  assert.equal((await inspectLocalFile(new File(['<!doctype html><html>Menu</html>'], 'menu.html', { type: 'text/html' }))).kind, 'html');
  assert.equal((await inspectLocalFile(new File([png], 'menu.png', { type: 'image/png' }))).kind, 'image');
  await assert.rejects(inspectLocalFile(new File([png], 'spoof.pdf', { type: 'application/pdf' })), /format/);
  await assert.rejects(inspectLocalFile(new File(['%PDF-1.7\n'], 'menu.pdf', { type: 'application/pdf' }), true), /image/);
  await assert.rejects(inspectLocalFile(new File(['<svg/>'], 'menu.svg', { type: 'image/svg+xml' })), /format/);
  await assert.rejects(inspectLocalFile(new File([new Uint8Array(MAX_MENU_BYTES + 1)], 'large.png')), /10 MB/);
  await assert.rejects(inspectLocalFile(new File([], 'empty.png')), /non-empty/);
});

test('recommendation preferences migrate independently from permanent Taste DNA', () => {
  const state = initialState();
  delete state.recommendationOptions;
  const restored = restoreState(JSON.stringify(state), null);
  assert.deepEqual(restored.recommendationOptions, { protein_preference: 'any', include_over_budget: true });
  restored.recommendationOptions = { protein_preference: 'seafood', include_over_budget: false };
  assert.deepEqual(restoreState(JSON.stringify(restored), null), restored);
  assert.deepEqual(restored.taste, state.taste);
});
test('saved structured notes carry actual choices and distinguish inferred from edited axes', () => {
  let draft = choose(newDraft(initialTaste()), 'anchors', 'ramen');
  draft = choose(draft, 'texture', 'chewy');
  draft = choose(draft, 'ingredients', 'chili');
  const record = { version: 3, engine: 'deterministic-v3.1', answers: draft.answers, savedAt: '2026-10-25T12:00:00Z' };
  const notes = recommendationEvidence(record, []);
  assert.deepEqual(notes.favorite_dishes, ['ramen']);
  assert.deepEqual(notes.textures, ['chewy']);
  assert.deepEqual(notes.liked_ingredients, ['chili']);
  assert.ok(notes.inferred_axes.includes('spice'));
  assert.ok(!recommendationEvidence(record, ['spice']).inferred_axes.includes('spice'));
  assert.ok(isContract('RecommendationTasteEvidence', notes));
  assert.deepEqual(recommendationEvidence(null, []).favorite_dishes, []);
});
test('sparse Taste Detective evidence survives saving, restoration and request construction', () => {
  let draft = choose(newDraft(initialTaste()), 'anchors', 'curry');
  draft = choose(draft, 'aromatics', 'spices');
  const reading = demoDetective.analyze(draft.answers);
  const state = initialState();
  state.taste = enrichProfile({ ...initialTaste(), complete: true }, reading);
  state.detective = { version: 3, engine: 'deterministic-v3.1', answers: draft.answers, savedAt: '2026-10-25T12:00:00Z' };
  const saved = restoreState(JSON.stringify(state), null);
  const request = { restaurant_id: 'spice-garden', menu_version: 'demo-example', constraints: saved.constraints,
    profile: saved.taste, taste_evidence: recommendationEvidence(saved.detective, saved.tasteEdits.axes), options: saved.recommendationOptions, bridge_feedback: [] };
  assert.ok(isContract('RecommendationRequest', request));
  assert.equal(request.profile.axes.aromatic, .85);
  assert.equal(request.profile.axes.spice, null);
  assert.equal(Object.values(request.profile.axes).filter(value => value !== null).length, 1);
  assert.deepEqual(request.taste_evidence.favorite_dishes, ['curry']);
  assert.deepEqual(request.taste_evidence.inferred_axes, []);
  assert.deepEqual(request.constraints, state.constraints);
});
test('Picks bind branch, version, DNA, every constraint, notes, options and exact overage', () => {
  const request = { restaurant_id: 'saigon-table', menu_version: 'v1', profile: initialTaste(),
    constraints: { ...initialConstraints(), max_price_minor: 1899 }, taste_evidence: recommendationEvidence(null, []),
    options: initialState().recommendationOptions };
  const rec = { dish: { id: 'one', price: { amount_minor: 1900 } }, budget: { target_minor: 1899, overage_minor: 1, status: 'above_target' } };
  const session = { restaurant: { id: request.restaurant_id }, menu_version: request.menu_version, profile: request.profile,
    constraints: request.constraints, taste_evidence: request.taste_evidence, options: request.options, recommendations: [rec] };
  assert.equal(sessionMatchesRequest(session, request), true);
  for (const delta of [{ restaurant: { id: 'another-branch' } }, { menu_version: 'v0' },
    { profile: { ...request.profile, exploration: .9 } }, { taste_evidence: { ...request.taste_evidence, textures: ['crisp'] } },
    { options: { ...request.options, protein_preference: 'beef' } },
    { recommendations: [rec, rec] }, { recommendations: [{ ...rec, budget: { ...rec.budget, overage_minor: 2 } }] }]) {
    assert.equal(sessionMatchesRequest({ ...session, ...delta }, request), false);
  }
  for (const delta of [{ max_price_minor: 1900 }, { mood: 'fresh' }, { appetite: 'light' }, { dietary_restrictions: ['vegetarian'] }, { allergies: { allergens: ['fish'], other: '' } }]) {
    assert.equal(sessionMatchesRequest(session, { ...request, constraints: { ...request.constraints, ...delta } }), false);
  }
  const hide = { ...request.options, include_over_budget: false };
  assert.equal(sessionMatchesRequest({ ...session, options: hide }, { ...request, options: hide }), false);
  const protectedRequest = { ...request, profile: { ...request.profile, dietary_restrictions: ['vegetarian'], allergies: { allergens: ['fish'], other: ' kiwi ' } } };
  assert.equal(sessionMatchesRequest({ ...session, profile: { ...protectedRequest.profile, allergies: { allergens: ['fish'], other: 'kiwi' } }, constraints: { ...request.constraints, dietary_restrictions: ['vegetarian'], allergies: { allergens: ['fish'], other: 'kiwi' } } }, protectedRequest), true);
});

test('TasteBridge feedback migration preserves old memories, strips prose, and bounds history', () => {
  const memory = { id: 'old', restaurant_id: 'saigon-table', restaurant_name: 'Saigon Table', dish_id: 'pho', dish_name: 'Pho Gà', liked: true,
    note: 'Untrusted prose is not culinary evidence', date: '2026-10-20T12:00:00Z' };
  const state = initialState(); state.feedback = [memory];
  const restored = restoreState(JSON.stringify(state), null);
  assert.equal(restored.feedback.length, 1);
  assert.equal(restored.feedback[0].menu_version, null);
  assert.equal(restored.feedback[0].note, memory.note);
  const wire = bridgeFeedback(restored.feedback);
  assert.ok(isContract('BridgeFeedback', wire[0]));
  assert.equal('note' in wire[0], false);
  assert.equal(wire[0].menu_version, null);
  assert.equal(bridgeFeedback([{ ...memory, restaurant_id: null }]).length, 0);
  assert.equal(bridgeFeedback(Array.from({ length: 25 }, (_, i) => ({ ...memory, id: String(i), menu_version: 'v1' }))).length, 20);
});
test('TasteBridge history and comparison identities bind a response to its request', () => {
  const request = { restaurant_id: 'saigon-table', menu_version: 'v1', profile: initialTaste(), constraints: initialConstraints(),
    taste_evidence: recommendationEvidence(null, []), options: initialState().recommendationOptions, bridge_feedback: [] };
  const rec = { dish: { id: 'pho', price: { amount_minor: 1800 } }, budget: { target_minor: 3000, overage_minor: 0, status: 'within_target' },
    taste_bridge: { restaurant_id: 'saigon-table', menu_version: 'v1', dish_id: 'pho' } };
  const session = { restaurant: { id: 'saigon-table' }, menu_version: 'v1', profile: request.profile, constraints: request.constraints,
    taste_evidence: request.taste_evidence, options: request.options, bridge_feedback: [], recommendations: [rec] };
  assert.equal(sessionMatchesRequest(session, request), true);
  for (const delta of [{ restaurant_id: 'wrong-branch' }, { menu_version: 'stale' }, { dish_id: 'unrelated' }]) {
    assert.equal(sessionMatchesRequest({ ...session, recommendations: [{ ...rec, taste_bridge: { ...rec.taste_bridge, ...delta } }] }, request), false);
  }
  const history = [{ id: 'memory', restaurant_id: 'saigon-table', dish_id: 'pho', menu_version: 'v1', liked: true, date: '2026-10-20T12:00:00Z' }];
  assert.equal(sessionMatchesRequest(session, { ...request, bridge_feedback: history }), false);
  assert.equal(sessionMatchesRequest({ ...session, bridge_feedback: [{ ...history[0], date: '2026-10-20T12:00:00+00:00' }] }, { ...request, bridge_feedback: history }), true);
});

test('TasteBridge presentation accepts actual validated demo evidence without rewriting it', () => {
  assert.ok(isContract('RecommendationSession', bridgeSession));
  const bridge = bridgeSession.recommendations[0].taste_bridge;
  assert.equal(readableTasteBridge(bridge), bridge);
  assert.deepEqual(withOptionalTasteBridges(bridgeSession), bridgeSession);
  const limited = { ...bridge, status: 'limited' };
  assert.equal(readableTasteBridge(limited), limited);
});

test('TasteBridge drops incomplete, unlinked or contradictory presentation graphs', () => {
  const original = bridgeSession.recommendations[0].taste_bridge;
  const attacks = [
    b => { b.schema_version = 999; },
    b => { b.anchor = null; },
    b => { b.shared = []; },
    b => { b.explanation = ''; },
    b => { b.shared[0].anchor_fact_id = 'missing'; },
    b => { b.shared[0].target_fact_id = b.shared[0].anchor_fact_id; },
    b => { b.shared[0].relation = 'different'; },
    b => { b.shared[0].attribute = 'liked'; },
    b => { b.shared.push(b.shared[0]); },
    b => { b.anchor.evidence_ids.push('unknown'); },
    b => { b.evidence.push(b.evidence[0]); },
    b => { b.evidence.push({ ...b.evidence[0], id: 'uncited' }); },
    b => { b.evidence.find(f => f.subject === 'target').dish_id = 'unrelated-dish'; },
    b => { b.evidence.find(f => f.attribute === 'liked').feedback_id = null; },
    b => { b.unavailable_reason = 'invalid_proposal'; },
    b => { b.status = 'unavailable'; },
  ];
  for (const attack of attacks) {
    const bridge = structuredClone(original); attack(bridge);
    assert.equal(readableTasteBridge(bridge), null, attack.toString());
  }
  for (const value of [undefined, null, {}, [], 'old bridge prose']) assert.equal(readableTasteBridge(value), null);
});

test('TasteBridge unavailable states never publish claims or invented compatibility', () => {
  for (const reason of ['insufficient_evidence', 'contradictory_evidence', 'ineligible', 'invalid_proposal', 'provider_unavailable']) {
    const bridge = { ...bridgeSession.recommendations[0].taste_bridge, status: 'unavailable', anchor: null,
      shared: [], differences: [], explanation: '', evidence: [], uncertainties: ['No supported comparison.'], unavailable_reason: reason };
    assert.equal(readableTasteBridge(bridge), bridge);
    assert.ok(bridgeFallback(reason).length > 20);
    assert.doesNotMatch(bridgeFallback(reason), /\d+%|safe to eat/i);
  }
  assert.match(bridgeFallback('invalid_proposal'), /couldn’t support/);
  assert.match(bridgeFallback('contradictory_evidence'), /conflict/);
  assert.match(bridgeFallback(), /don’t have/);
});

test('TasteBridge optional decoding leaves every other response field strictly validated', async t => {
  let payload = structuredClone(bridgeSession);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  for (const bridge of [undefined, null, {}, { schema_version: 999 }, 'legacy text']) {
    payload = structuredClone(bridgeSession);
    if (bridge === undefined) delete payload.recommendations[0].taste_bridge;
    else payload.recommendations[0].taste_bridge = bridge;
    const before = structuredClone(payload);
    const result = await apiRequest('recommendation-sessions', 'RecommendationSession', {});
    assert.equal(result.recommendations[0].taste_bridge, null);
    assert.deepEqual(result, { ...payload, recommendations: payload.recommendations.map(rec => ({ ...rec, taste_bridge: null })) });
    assert.deepEqual(payload, before); // Never mutate a cached or shared response.
  }
  for (const attack of [
    s => { delete s.constraints; },
    s => { delete s.profile; },
    s => { s.menu_version = ''; },
    s => { s.restaurant.id = ''; },
    s => { s.constraints.allergies.allergens = ['invented']; },
    s => { s.constraints.dietary_restrictions = ['invented']; },
    s => { s.constraints.max_price_minor = -1; },
    s => { s.profile.axes.spice = 2; },
    s => { s.recommendations[0].dish.price.amount_minor = 19.99; },
    s => { s.recommendations[0].budget.overage_minor = -1; },
    s => { delete s.recommendations[0].compatibility; },
    s => { s.recommendations[0].unexpected = true; },
    s => { s.unexpected = true; },
    s => { s.recommendations = [null]; },
  ]) {
    payload = structuredClone(bridgeSession); delete payload.recommendations[0].taste_bridge; attack(payload);
    await assert.rejects(apiRequest('recommendation-sessions', 'RecommendationSession', {}), /unexpected response/, attack.toString());
  }
});

test('meal combinations are an additive optional contract without relaxing required Picks fields', () => {
  assert.equal('meal_combinations' in bridgeSession, false); // Older response remains readable.
  assert.ok(isContract('RecommendationSession', bridgeSession));
  assert.ok(isContract('RecommendationSession', { ...bridgeSession, meal_combinations: null }));
  const unavailable = { schema_version: 1, restaurant_id: bridgeSession.restaurant.id, menu_version: bridgeSession.menu_version,
    provider: 'structured_demo_pairing_v1', mode: 'demo', status: 'unavailable', combinations: [],
    unavailable_reason: 'insufficient_menu_evidence', uncertainties: [] };
  assert.ok(isContract('RecommendationSession', { ...bridgeSession, meal_combinations: unavailable }));
  for (const value of [{}, 'made-up meal', { ...unavailable, combinations: [{ subtotal_minor: 30.99 }] }]) {
    assert.equal(isContract('RecommendationSession', { ...bridgeSession, meal_combinations: value }), false);
  }
  for (const field of ['recommendations', 'constraints', 'profile', 'evaluation', 'menu_version']) {
    const broken = { ...bridgeSession, meal_combinations: unavailable }; delete broken[field];
    assert.equal(isContract('RecommendationSession', broken), false);
  }
  const proposal = { restaurant_id: 'saigon-table', menu_version: 'demo-v1', main_dish_id: 'pho',
    items: [{ item_id: 'pho', amount_minor: 1800, currency: 'USD' }, { item_id: 'spring-rolls', amount_minor: 1300, currency: 'USD' }],
    subtotal_minor: 3100, claims: [{ left_fact_id: 'main-fact', right_fact_id: 'side-fact', relation: 'shared' }] };
  assert.ok(isContract('MealPairingProposal', proposal));
  assert.equal(isContract('MealPairingProposal', { ...proposal, items: proposal.items.slice(0, 1) }), false);
  assert.equal(isContract('MealPairingProposal', { ...proposal, claims: [] }), false);
});
