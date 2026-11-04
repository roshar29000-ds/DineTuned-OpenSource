const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { stretchPicks } = require('../lib/stretch.ts');
const { isContract } = require('../lib/validation.ts');
const { withOptionalTasteBridges } = require('../lib/tastebridge.ts');
const { sessionMatchesRequest } = require('../lib/recommendations.ts');
const base = require('./fixtures/tastebridge-session.json');

function session(count = 1) {
  const value = structuredClone(base);
  const pick = value.recommendations[0];
  delete pick.category;
  pick.budget = { target_minor: 2199, overage_minor: 1, status: 'above_target' };
  value.constraints.max_price_minor = 2199;
  value.evaluation.constraints.max_price_minor = 2199;
  value.recommendations = [];
  value.worth_the_stretch = { schema_version: 1, restaurant_id: value.restaurant.id, menu_version: value.menu_version,
    provider: 'deterministic-v3.4a', mode: 'demo', picks: [] };
  for (let i = 0; i < count; i++) {
    const next = structuredClone(pick);
    // Explicit presentation fixture, not additional production menu data.
    if (i) { next.dish.id = `fixture-${i}`; next.taste_bridge = null; }
    value.worth_the_stretch.picks.push(next);
  }
  value.evaluation.items = value.worth_the_stretch.picks.map(rec => ({ item_id: rec.dish.id, eligible: false, reasons: [{ code: 'budget', message: 'Above target' }] }));
  return value;
}

test('stretch displays zero to two backend selections with exact amounts and unaltered evidence', () => {
  for (const count of [0, 1, 2]) {
    const value = session(count);
    assert.ok(isContract('RecommendationSession', value));
    assert.equal(stretchPicks(value), value.worth_the_stretch.picks);
    if (count) {
      assert.equal(stretchPicks(value)[0].budget.overage_minor, 1);
      assert.equal(stretchPicks(value)[0].why, base.recommendations[0].why);
    }
  }
  assert.equal(isContract('RecommendationSession', session(3)), false);
});

test('stretch gracefully omits old, missing, empty and hidden selections', () => {
  assert.deepEqual(stretchPicks(base), []);
  for (const change of [s => { s.worth_the_stretch = null; }, s => { delete s.worth_the_stretch; },
    s => { s.options.include_over_budget = false; }, s => { s.worth_the_stretch.picks = []; }]) {
    const value = session(); change(value);
    assert.deepEqual(stretchPicks(value), []);
  }
});

test('stretch rejects stale identity, duplicates, unsupported prices, hard exclusions and mismatched bridges', () => {
  const changes = [
    s => { s.worth_the_stretch.restaurant_id = 'other'; },
    s => { s.worth_the_stretch.menu_version = 'old'; },
    s => { s.evaluation.menu_version = 'old'; },
    s => { s.worth_the_stretch.picks.push(structuredClone(s.worth_the_stretch.picks[0])); },
    s => { s.recommendations = [{ ...s.worth_the_stretch.picks[0], category: 'Best match' }]; },
    s => { s.worth_the_stretch.picks[0].dish.available = false; },
    s => { s.worth_the_stretch.picks[0].dish.price = { amount_minor: null, status: 'unknown', currency: 'USD', basis: 'per_dish_before_tax_tip' }; },
    s => { s.worth_the_stretch.picks[0].budget.overage_minor = 2; },
    s => { s.worth_the_stretch.picks[0].budget.target_minor = 2000; },
    s => { s.worth_the_stretch.picks[0].budget.status = 'within_target'; },
    s => { s.constraints.max_price_minor = 3000; },
    s => { s.evaluation.items[0].reasons.push({ code: 'allergen_unknown', message: 'Unknown' }); },
    s => { s.evaluation.items = []; },
    s => { s.worth_the_stretch.picks[0].compatibility.evidence = []; },
    s => { s.worth_the_stretch.picks[0].taste_bridge.dish_id = 'unrelated'; },
  ];
  for (const change of changes) {
    const value = session(); change(value);
    assert.deepEqual(stretchPicks(value), [], change.toString());
  }
});

test('stretch optional comparison tolerance never relaxes other response validation', () => {
  const value = session(); value.worth_the_stretch.picks[0].taste_bridge = { unsupported: true };
  const normalized = withOptionalTasteBridges(value);
  assert.ok(isContract('RecommendationSession', normalized));
  assert.equal(normalized.worth_the_stretch.picks[0].taste_bridge, null);
  assert.equal(stretchPicks(normalized).length, 1);
  for (const change of [s => { delete s.profile; }, s => { delete s.worth_the_stretch.provider; },
    s => { s.worth_the_stretch.picks[0].dish.price.amount_minor = '2200'; },
    s => { s.worth_the_stretch.picks[0].dish.unexpected = true; },
    s => { s.worth_the_stretch.picks[0].budget.overage_minor = .5; }]) {
    const invalid = structuredClone(value); change(invalid);
    assert.equal(isContract('RecommendationSession', withOptionalTasteBridges(invalid)), false, change.toString());
  }
});

test('enclosing stretch session stays bound to current preferences and restaurant', () => {
  const value = session();
  const request = { restaurant_id: value.restaurant.id, menu_version: value.menu_version, constraints: value.constraints,
    profile: value.profile, options: value.options, taste_evidence: value.taste_evidence, bridge_feedback: value.bridge_feedback };
  assert.ok(sessionMatchesRequest(value, request));
  for (const change of [r => { r.restaurant_id = 'other'; }, r => { r.menu_version = 'other'; },
    r => { r.constraints.max_price_minor = 2000; }, r => { r.options.include_over_budget = false; },
    r => { r.constraints.allergies.allergens = ['peanut']; }, r => { r.profile.axes.spice = .99; }]) {
    const changed = structuredClone(request); change(changed);
    assert.equal(sessionMatchesRequest(value, changed), false);
  }
});
