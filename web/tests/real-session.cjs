const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { RealTableSession, signedTokenCurrent, signedTokenExpired } = require('../lib/menu-retrieval/real-session.ts');

const token = seconds => Buffer.from(JSON.stringify({ expires: Math.floor(Date.now() / 1000) + seconds })).toString('base64url') + '.offline-signature';
const handoff = (placeId = 'girl-and-goat', proof = token(3600)) => ({
  restaurant: { place_id: placeId }, source_discovery_token: proof,
});
const extraction = (placeId = 'girl-and-goat', proof = token(3600)) => ({
  restaurant_id: placeId, recommendation_token: proof,
  menu: { restaurant_id: placeId, version: 'source-hash-v1' },
});
const picks = () => ({ restaurant_id: 'girl-and-goat', menu_version: 'source-hash-v1', recommendations: [{ dish: { id: 'dish-a' } }] });

test('same guest keeps one signed table and Picks across route remounts', () => {
  const table = new RealTableSession();
  const selected = handoff(), menu = extraction();
  table.setSelection(selected);
  table.setExtraction(selected, menu);
  table.setPicks('taste-budget-menu-key', picks());
  assert.equal(table.getSelection(), selected);
  assert.equal(table.getExtraction(selected), menu);
  assert.deepEqual(table.getPicks('taste-budget-menu-key'), picks());
  assert.equal(table.getPicks('changed-budget'), null);
  table.setSelection(selected); // auth refresh and remount do not clear the table
  assert.equal(table.getExtraction(selected), menu);
});

test('new branch or signed selection clears the previous menu and Picks', () => {
  const table = new RealTableSession();
  const selected = handoff();
  table.setSelection(selected); table.setExtraction(selected, extraction()); table.setPicks('key', picks());
  table.setSelection(handoff('another-branch'));
  assert.equal(table.getExtraction(selected), null);
  assert.equal(table.getPicks('key'), null);
  table.setExtraction(selected, extraction());
  assert.equal(table.getExtraction(selected), null);
  table.clear();
  assert.equal(table.getSelection(), null);
});

test('expired recommendation proof blocks new work while preserving a read-only prior selection', () => {
  const table = new RealTableSession();
  const selected = handoff(), menu = extraction('girl-and-goat', token(60));
  table.setSelection(selected); table.setExtraction(selected, menu); table.setPicks('key', picks());
  const now = Date.now;
  try {
    Date.now = () => now() + 120_000;
    assert.equal(table.getExtraction(selected).recommendation_token, null);
    assert.equal(table.getExtractionForView(selected), menu);
    assert.deepEqual(table.getPicks('key'), picks());
    assert.equal(table.getPicks('different-preferences'), null);
    assert.equal(signedTokenCurrent(menu.recommendation_token), false);
    assert.equal(signedTokenExpired(menu.recommendation_token), true);
  } finally { Date.now = now; }
  assert.equal(signedTokenExpired('opaque-offline-fixture'), false); // backend remains authoritative
});

test('read-only Picks survive token removal but never a changed budget or guest', () => {
  const table = new RealTableSession(), selected = handoff(), menu = extraction();
  table.setSelection(selected); table.setExtraction(selected, menu);
  const key = (proof, budget, guest) => JSON.stringify([{ extraction: { menu: menu.menu, recommendation_token: proof }, constraints: { max_price_minor: budget } }, guest]);
  table.setPicks(key(menu.recommendation_token, 2500, 'guest-one'), picks());
  assert.deepEqual(table.getPicks(key(null, 2500, 'guest-one')), picks());
  assert.equal(table.getPicks(key(null, 3000, 'guest-one')), null);
  assert.deepEqual(table.getSavedPicksForView('guest-one'), picks());
  assert.equal(table.getSavedPicksForView('guest-two'), null);
  assert.equal(table.getPicks(key(null, 2500, 'guest-two')), null);
});

test('a new tab restores the same guest and menu without a new recommendation request', () => {
  const original = new RealTableSession(), selected = handoff(), menu = extraction();
  const input = { extraction: menu, profile: { favorites: 'Grilled chicken' }, taste_evidence: {},
    constraints: { max_price_minor: 2500 }, options: { include_over_budget: true }, refinements: { preferences: [], avoid_dish_ids: [] } };
  const result = { ...picks(), request_id: 'offline-request' };
  original.setSelection(selected); original.setExtraction(selected, menu);
  original.setPicks(JSON.stringify([input, 'guest-one']), result);
  const newTab = new RealTableSession();
  const backup = { selection: selected, extraction: menu, request: { ...input, request_id: 'offline-request' },
    picks: result, updated_at: new Date().toISOString() };
  assert.equal(newTab.restore(backup, 'guest-one'), true);
  assert.deepEqual(newTab.getPicks(JSON.stringify([input, 'guest-one'])), result);
  assert.equal(newTab.getPicks(JSON.stringify([input, 'guest-two'])), null);
  assert.equal(newTab.getPicks(JSON.stringify([{ ...input, constraints: { max_price_minor: 3000 } }, 'guest-one'])), null);
  const newer = new RealTableSession(), revision = newer.getRevision();
  newer.setSelection(handoff('another-branch'));
  assert.equal(newer.restore(backup, 'guest-one', revision), false);
  assert.equal(newer.getSelection().restaurant.place_id, 'another-branch');
  assert.equal(new RealTableSession().restore({ ...backup, picks: { ...result, menu_version: 'stale' } }, 'guest-one'), false);
});
