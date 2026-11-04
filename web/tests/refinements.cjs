const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { emptyRefinements, hasRefinements, toggleRefinement, tryAnother, supportedRefinement } = require('../lib/refinements.ts');
const { sessionMatchesRequest } = require('../lib/recommendations.ts');
const { isContract } = require('../lib/validation.ts');
const { withOptionalTasteBridges } = require('../lib/tastebridge.ts');
const { tablePresentation } = require('../lib/meal-combinations.ts');
const base = require('./fixtures/tastebridge-session.json');
const table = require('./fixtures/table-combination.json');

function request(value = base) {
  return { restaurant_id: value.restaurant.id, menu_version: value.menu_version, constraints: value.constraints,
    profile: value.profile, options: value.options, taste_evidence: value.taste_evidence, bridge_feedback: value.bridge_feedback,
    refinements: emptyRefinements() };
}
function result(refinements) {
  return { request: refinements, provider: 'structured-demo-refinements-v1', mode: 'demo', status: 'applied', message: 'Supported demo ordering', limitations: [] };
}

test('refinement toggles combine canonically, remain removable and reset without mutation', () => {
  const original = emptyRefinements();
  const spicy = toggleRefinement(original, 'spicier');
  const lighter = toggleRefinement(spicy, 'lighter');
  assert.deepEqual(lighter.preferences, ['lighter', 'spicier']);
  assert.deepEqual(original, { preferences: [], avoid_dish_ids: [] });
  assert.deepEqual(toggleRefinement(lighter, 'lighter'), spicy);
  assert.deepEqual(toggleRefinement(spicy, 'spicier'), original);
  assert.ok(hasRefinements(lighter));
  assert.equal(hasRefinements(emptyRefinements()), false);
});

test('plain-language input maps only to supported temporary refinements', () => {
  assert.equal(supportedRefinement('Something lighter'), 'lighter');
  assert.equal(supportedRefinement('more spicy'), 'spicier');
  assert.equal(supportedRefinement('less creamy'), 'less_creamy');
  assert.equal(supportedRefinement('more adventurous'), 'adventurous');
  assert.equal(supportedRefinement('avoid shellfish'), null);
  assert.equal(supportedRefinement('no peanuts'), null);
});

test('try another uses actual primary IDs once, preserves preferences and bounds history', () => {
  const prefs = toggleRefinement(emptyRefinements(), 'lighter');
  const next = tryAnother(prefs, base);
  assert.deepEqual(next.avoid_dish_ids, base.recommendations.map(rec => rec.dish.id));
  assert.deepEqual(next.preferences, ['lighter']);
  assert.deepEqual(prefs.avoid_dish_ids, []);
  assert.equal(tryAnother(next, base), null);
  assert.equal(tryAnother(prefs, { ...base, recommendations: [] }), null);
  assert.equal(tryAnother({ ...prefs, avoid_dish_ids: Array.from({ length: 50 }, (_, i) => `prior-${i}`) }, base), null);
});

test('older responses work only without active refinements and malformed core fields stay invalid', () => {
  assert.ok(isContract('RecommendationSession', base));
  assert.ok(sessionMatchesRequest(base, request()));
  const active = { ...request(), refinements: toggleRefinement(emptyRefinements(), 'spicier') };
  assert.equal(sessionMatchesRequest(base, active), false);
  const value = { ...structuredClone(base), refinement_result: result(active.refinements) };
  assert.ok(isContract('RecommendationSession', value));
  assert.ok(sessionMatchesRequest(value, active));
  for (const mutate of [s => { s.refinement_result.request.preferences = ['magic']; }, s => { delete s.profile; },
    s => { s.recommendations[0].dish.price.amount_minor = '2200'; }, s => { delete s.refinement_result.message; }]) {
    const invalid = structuredClone(value); mutate(invalid);
    assert.equal(isContract('RecommendationSession', withOptionalTasteBridges(invalid)), false);
  }
});

test('stale refinement results, removed choices and skipped primaries fail response binding', () => {
  const active = { ...request(), refinements: toggleRefinement(emptyRefinements(), 'lighter') };
  const value = { ...structuredClone(base), refinement_result: result(active.refinements) };
  assert.ok(sessionMatchesRequest(value, active));
  assert.equal(sessionMatchesRequest(value, request()), false);
  assert.equal(sessionMatchesRequest(value, { ...active, refinements: toggleRefinement(active.refinements, 'spicier') }), false);
  const skip = tryAnother(active.refinements, base);
  assert.equal(sessionMatchesRequest({ ...value, refinement_result: result(skip) }, { ...active, refinements: skip }), false);
  assert.equal(sessionMatchesRequest(value, { ...active, menu_version: 'stale' }), false);
  assert.equal(sessionMatchesRequest(value, { ...active, restaurant_id: 'different' }), false);
});

test('a skipped dish cannot return in a table combination', () => {
  const value = structuredClone(base);
  value.constraints.max_price_minor = table.main.budget.target_minor;
  value.recommendations[0].budget = structuredClone(table.main.budget);
  value.meal_combinations = { schema_version: 1, restaurant_id: value.restaurant.id, menu_version: value.menu_version,
    provider: 'structured_demo_pairing_v1', mode: 'demo', status: 'available', combinations: [structuredClone(table)], unavailable_reason: null, uncertainties: [] };
  assert.equal(tablePresentation(value).combinations.length, 1);
  value.refinement_result = result({ preferences: [], avoid_dish_ids: [table.additions[0].item_id] });
  assert.ok(isContract('RecommendationSession', value));
  assert.equal(tablePresentation(value).combinations.length, 0);
});
