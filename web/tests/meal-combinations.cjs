const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { tablePresentation, tablePortion, tableMedia, tableMenuMatches, tableFallback } = require('../lib/meal-combinations.ts');
const { isContract } = require('../lib/validation.ts');
const base = require('./fixtures/tastebridge-session.json');
const fixture = require('./fixtures/table-combination.json');

function session() {
  const value = structuredClone(base);
  value.constraints.max_price_minor = fixture.main.budget.target_minor;
  value.recommendations[0].budget = structuredClone(fixture.main.budget);
  value.meal_combinations = { schema_version: 1, restaurant_id: value.restaurant.id, menu_version: value.menu_version,
    provider: 'structured_demo_pairing_v1', mode: 'demo', status: 'available', combinations: [structuredClone(fixture)], unavailable_reason: null, uncertainties: [] };
  return value;
}

test('table renders backend amounts and explanation without deriving a meal budget', () => {
  const value = session();
  assert.ok(isContract('RecommendationSession', value));
  const result = tablePresentation(value);
  assert.equal(result.combinations.length, 1);
  assert.equal(result.combinations[0], value.meal_combinations.combinations[0]);
  assert.equal(result.combinations[0].subtotal_minor, 3500);
  assert.equal(result.combinations[0].main.budget.overage_minor, 200);
  assert.equal(result.combinations[0].rationale, fixture.rationale);
  assert.equal(result.fallback, null);
});

test('table handles older, unavailable, limited and zero-result responses', () => {
  assert.equal(tablePresentation(base).fallback, 'missing');
  for (const reason of ['no_primary_picks', 'insufficient_menu_evidence', 'provider_unavailable', 'invalid_proposal', 'invalid_context']) {
    const value = session();
    value.meal_combinations = { ...value.meal_combinations, status: 'unavailable', combinations: [], unavailable_reason: reason };
    assert.deepEqual(tablePresentation(value), { combinations: [], limited: false, fallback: reason });
    assert.ok(tableFallback(reason).length > 30);
  }
  const value = session(); value.meal_combinations.status = 'limited';
  assert.equal(tablePresentation(value).limited, true);
  value.meal_combinations.combinations = [];
  assert.equal(tablePresentation(value).fallback, 'insufficient_menu_evidence');
});

test('table rejects stale restaurant, version, primary, budget and unsupported evidence', () => {
  const attacks = [
    s => { s.meal_combinations.restaurant_id = 'another-branch'; },
    s => { s.meal_combinations.menu_version = 'stale'; },
    s => { s.meal_combinations.combinations[0].menu_version = 'stale'; },
    s => { s.meal_combinations.combinations[0].restaurant_id = 'another-branch'; },
    s => { s.meal_combinations.combinations[0].main.item_id = 'not-a-primary'; },
    s => { s.meal_combinations.combinations[0].main.price_minor = 2199; },
    s => { s.meal_combinations.combinations[0].main.name = 'Unrelated main'; },
    s => { s.meal_combinations.combinations[0].main.budget.overage_minor = 199; },
    s => { s.meal_combinations.combinations[0].additions[0].budget.target_minor = 4000; },
    s => { s.meal_combinations.combinations[0].additions.push(s.meal_combinations.combinations[0].main); },
    s => { s.meal_combinations.combinations[0].evidence = []; },
    s => { s.meal_combinations.combinations[0].claims[0].left_fact_id = 'invented'; },
    s => { s.meal_combinations.combinations[0].evidence[0].item_id = 'unrelated'; },
    s => { s.meal_combinations.combinations[0].claims = s.meal_combinations.combinations[0].claims.slice(1); },
    s => { s.options.include_over_budget = false; },
  ];
  for (const attack of attacks) {
    const value = session(); attack(value);
    assert.equal(tablePresentation(value).combinations.length, 0, attack.toString());
    assert.equal(value.recommendations.length, 1);
  }
});

test('table omits an invalid or duplicate combination without dropping the valid meal', () => {
  const value = session();
  value.meal_combinations.combinations.push(structuredClone(fixture));
  const result = tablePresentation(value);
  assert.equal(result.combinations.length, 1);
  assert.equal(result.limited, true);
});

test('table portions come only from explicit menu evidence, with uncertainty kept unknown', () => {
  assert.equal(tablePortion(fixture, fixture.main.item_id), 'hearty');
  assert.equal(tablePortion(fixture, fixture.additions[0].item_id), 'light');
  const unknown = structuredClone(fixture); unknown.evidence = unknown.evidence.filter(fact => fact.attribute !== 'portion');
  assert.equal(tablePortion(unknown, fixture.main.item_id), null);
  const conflicting = structuredClone(fixture);
  const portion = conflicting.evidence.find(fact => fact.attribute === 'portion');
  conflicting.evidence.push({ ...portion, id: 'conflicting', value: portion.value === 'light' ? 'hearty' : 'light' });
  assert.equal(tablePortion(conflicting, portion.item_id), null);
});

test('table illustrations use exact menu identity and never guess assets from names', () => {
  const value = session(), side = fixture.additions[0];
  const media = { kind: 'placeholder', motif: 'dumplings', accent: '#dce6d6', label: 'Illustration' };
  const menu = { restaurant: value.restaurant, version: value.menu_version, categories: [{ items: [{ id: side.item_id, name: side.name,
    category_id: side.category_id, price: { amount_minor: side.price_minor }, media }] }] };
  assert.equal(tableMedia(side, value, menu), media);
  assert.equal(tableMedia(fixture.main, value, null), value.recommendations[0].dish.media);
  assert.equal(tableMedia(side, value, null), undefined);
  for (const changed of [{ ...menu, version: 'stale' }, { ...menu, restaurant: { id: 'another-branch' } }]) {
    assert.equal(tableMenuMatches(value, changed), false);
    assert.equal(tableMedia(side, value, changed), undefined);
  }
  menu.categories[0].items[0].name = 'Mismatched name';
  assert.equal(tableMedia(side, value, menu), undefined);
});
