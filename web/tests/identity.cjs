const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { ensureIdentity, identityInitializer } = require('../lib/identity/session.ts');
const { cloudConfiguration } = require('../lib/identity/config.ts');
const { CloudMemoryRepository, tasteDocument } = require('../lib/memory-repository.ts');
const { initialState } = require('../lib/storage.ts');
const { isContract } = require('../lib/validation.ts');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KEY = 'sb_publishable_offline_test_key_only_12345';
const TOKEN = 'offline.test.signature';
const NOW = '2026-10-28T12:00:00Z';

function fixture() {
  const values = new Map([['dinetuned-v2', JSON.stringify(initialState())]]);
  let session = null, signups = 0;
  const user = { id: A, role: 'authenticated', is_anonymous: true };
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    signInAnonymously: async () => { signups++; session = { access_token: TOKEN, user }; return { data: { session }, error: null }; },
  };
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  return { auth, storage, values, user, signups: () => signups };
}

test('missing configuration remains local; privileged or incomplete configuration is rejected', () => {
  assert.deepEqual(cloudConfiguration('', ''), { mode: 'local' });
  assert.equal(cloudConfiguration('https://project.supabase.co', KEY).mode, 'supabase');
  for (const [url, key] of [['https://project.supabase.co', 'sb_secret_private'], ['https://project.supabase.co', 'eyJservice-role'],
    ['', KEY], ['https://project.supabase.co', ''], ['http://untrusted.example', KEY], ['https://project.supabase.co/evil', KEY], ['https://u:p@project.supabase.co', KEY]]) {
    assert.throws(() => cloudConfiguration(url, key));
  }
});

test('guest identity survives reload and local Taste DNA is never overwritten', async () => {
  const f = fixture(), before = f.values.get('dinetuned-v2');
  assert.deepEqual(await ensureIdentity(f.auth, f.storage, 'guest'), { id: A, isAnonymous: true });
  assert.deepEqual(await ensureIdentity(f.auth, f.storage, 'guest'), { id: A, isAnonymous: true });
  assert.equal(f.signups(), 1);
  assert.equal(f.values.get('dinetuned-v2'), before);
  f.user.is_anonymous = false; // Future same-ID account upgrade needs no data ownership migration.
  assert.equal((await ensureIdentity(f.auth, f.storage, 'guest')).isAnonymous, false);
});

test('Strict Mode/concurrent initialization shares the sign-in operation', async () => {
  const f = fixture();
  const initialize = identityInitializer(() => ensureIdentity(f.auth, f.storage, 'guest'));
  const [one, two, three] = await Promise.all([initialize(), initialize(), initialize()]);
  assert.deepEqual(one, two); assert.deepEqual(two, three); assert.equal(f.signups(), 1);
});

test('missing or failed old session never silently creates another guest', async () => {
  const f = fixture(); f.values.set('guest', A);
  await assert.rejects(ensureIdentity(f.auth, f.storage, 'guest'), /session is missing/);
  f.auth.getSession = async () => ({ data: { session: null }, error: new Error('private refresh token') });
  await assert.rejects(ensureIdentity(f.auth, f.storage, 'guest'), /could not be restored/);
  assert.equal(f.signups(), 0);
});

test('unverified users, changed identities and unavailable storage fail without clearing local data', async () => {
  const f = fixture(), before = f.values.get('dinetuned-v2');
  await ensureIdentity(f.auth, f.storage, 'guest');
  f.auth.getUser = async () => ({ data: { user: { ...f.user, id: B } }, error: null });
  await assert.rejects(ensureIdentity(f.auth, f.storage, 'guest'), /could not be verified/);
  f.auth.getUser = async () => ({ data: { user: f.user }, error: null });
  f.values.set('guest', B);
  await assert.rejects(ensureIdentity(f.auth, f.storage, 'guest'), /identity changed/);
  await assert.rejects(ensureIdentity(f.auth, { getItem() { throw new Error('blocked'); } }, 'guest'), /storage is unavailable/);
  assert.equal(f.values.get('dinetuned-v2'), before);
});

test('Taste DNA backup reuses contracts and excludes temporary restaurant cravings', () => {
  const state = initialState(); state.constraints.mood = 'bold'; state.constraints.max_price_minor = 500;
  const document = tasteDocument(state);
  assert.ok(isContract('TasteDocument', document));
  assert.equal(document.profile, state.taste);
  assert.ok(!('constraints' in document) && !('selection' in document) && !('feedback' in document));
  assert.equal(isContract('MemoryIdentity', { user_id: 'not-a-uuid', is_anonymous: true, storage: 'supabase' }), false);
});

test('cloud repository uses only a fresh bearer token and preserves revision guards', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; });
  const document = tasteDocument(initialState());
  const row = { id: A, user_id: A, created_at: NOW, updated_at: NOW, revision: 2, source: 'user_reported', document };
  let observed;
  global.fetch = async (url, options) => { observed = { url, options }; return Response.json(row); };
  const repo = new CloudMemoryRepository(async () => ({ token: TOKEN, userId: A }));
  assert.equal((await repo.saveProfile({ document, expected_revision: 1 })).revision, 2);
  assert.equal(observed.options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(observed.options.cache, 'no-store');
  assert.equal(JSON.parse(observed.options.body).expected_revision, 1);
  assert.equal('user_id' in JSON.parse(observed.options.body), false);
  global.fetch = async () => Response.json({ detail: 'conflict' }, { status: 409 });
  await assert.rejects(repo.saveProfile({ document, expected_revision: 1 }), /backup changed/);
});

test('foreign and stale identity responses cannot be shown as current backups', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; });
  const row = { id: A, user_id: B, created_at: NOW, updated_at: NOW, revision: 1, source: 'user_reported', document: tasteDocument(initialState()) };
  global.fetch = async () => Response.json({ profile: row });
  await assert.rejects(new CloudMemoryRepository(async () => ({ token: TOKEN, userId: A })).profile(), /ownership/);
  let calls = 0; row.user_id = A;
  await assert.rejects(new CloudMemoryRepository(async () => ({ token: TOKEN, userId: ++calls === 1 ? A : B })).profile(), /identity changed/);
});

test('runtime config endpoint never exposes a secret key', t => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  t.after(() => { if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = key; });
  process.env.SUPABASE_URL = 'https://project.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_never_ship_this';
  const { GET } = require('../app/api/identity/config/route.ts');
  const response = GET(); assert.equal(response.status, 503);
  return response.text().then(body => assert.ok(!body.includes('sb_secret')));
});

test('relay forwards bearer only on allowlisted private routes and rejects cross-origin writes', async t => {
  const previous = global.fetch; t.after(() => { global.fetch = previous; });
  const { NextRequest } = require('next/server');
  const relay = require('../app/api/dinetuned/[...path]/route.ts');
  let seen;
  global.fetch = async (url, options) => { seen = options; return Response.json({ profile: null }); };
  const context = { params: Promise.resolve({ path: ['memory', 'profile'] }) };
  const response = await relay.GET(new NextRequest('http://localhost:3000/api/dinetuned/memory/profile', { headers: { Authorization: 'Bearer ' + TOKEN } }), context);
  assert.equal(response.status, 200); assert.equal(seen.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await relay.GET(new NextRequest('http://localhost:3000/api/dinetuned/memory/profile'), context)).status, 401);
  assert.equal((await relay.POST(new NextRequest('http://localhost:3000/api/dinetuned/memory/profile', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, Origin: 'https://other.example' } }), context)).status, 403);
  await relay.GET(new NextRequest('http://localhost:3000/api/dinetuned/health', { headers: { Authorization: 'Bearer ' + TOKEN } }), { params: Promise.resolve({ path: ['health'] }) });
  assert.equal('Authorization' in seen.headers, false);
});

test('stable identity access uses rotated tokens and revokes old or mismatched users', async () => {
  const { IdentityAccess } = require('../lib/identity/access.ts');
  let session = { access_token: 'first', user: { id: A } };
  const auth = { getSession: async () => ({ data: { session }, error: null }) };
  const access = new IdentityAccess(auth, A), callback = access.getAccessToken;
  assert.equal(await callback(), 'first');
  session = { ...session, access_token: 'rotated' };
  assert.equal(access.getAccessToken, callback); assert.equal(await callback(), 'rotated');
  session = { ...session, user: { id: B } };
  await assert.rejects(callback(), /session changed/);
  session = { ...session, user: { id: A } };
  access.revoke(); await assert.rejects(callback(), /session changed/);
});

test('identity revocation during token acquisition prevents stale authorization', async () => {
  const { IdentityAccess } = require('../lib/identity/access.ts');
  let release;
  const access = new IdentityAccess({ getSession: () => new Promise(resolve => { release = resolve; }) }, A);
  const token = access.getAccessToken(); access.revoke();
  release({ data: { session: { access_token: TOKEN, user: { id: A } } }, error: null });
  await assert.rejects(token, /session changed/);
});
