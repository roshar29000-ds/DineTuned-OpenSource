// Real PostgreSQL execution in memory. Never connects to Supabase or Meta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const H = '33333333-3333-4333-8333-333333333333';
const E = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';
const document = { profile: { schema_version: 2, complete: true }, evidence: {}, detective: null, edited_axes: [], exploration_edited: false };
const tables = ['taste_profiles', 'recommendation_history', 'dining_events', 'dish_feedback'];

test('PostgreSQL migration, authenticated identities, owner isolation and constraints', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users(id) values ('${A}'), ('${B}');`);
    const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202610280001_private_memory.sql'), 'utf8');
    await db.exec(migration);
    const identity = async (user, role = 'authenticated') => {
      await db.exec(`reset role; set role ${role};`);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    };
    await t.test('all private tables force RLS and have owner indexes', async () => {
      const rows = (await db.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[])", [tables])).rows;
      assert.equal(rows.length, 4);
      assert.ok(rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
      const indexes = (await db.query("select tablename, indexdef from pg_indexes where schemaname='public'")).rows;
      for (const table of tables) assert.ok(indexes.some(row => row.tablename === table && row.indexdef.includes('user_id')));
    });
    await t.test('anonymous signed-in user can save own rows and timestamps are server-owned', async () => {
      await identity(A);
      const profile = (await db.query("insert into taste_profiles(document, created_at, revision) values ($1, '2000-01-01', 99) returning *", [document])).rows[0];
      assert.equal(profile.user_id, A);
      assert.equal(profile.revision, 1);
      assert.ok(new Date(profile.created_at).getFullYear() > 2020);
      await db.query("insert into recommendation_history(id, session_id, restaurant_id, menu_version, dishes, reported_provider) values ($1, 'session-a', 'casa-sol', 'v1', '[]', 'demo')", [H]);
      await db.query("insert into dining_events(id, event_type, restaurant_id, menu_version, dish_id, occurred_at, recommendation_id) values ($1, 'tasted', 'casa-sol', 'v1', 'taco', now(), $2)", [E, H]);
      await db.query("insert into dish_feedback(id, event_id, feedback, rating, tags) values ($1, $2, $3, 5, array['great_texture'])", [F, E,
        { id: 'local-rating', restaurant_name: 'Casa Sol', dish_id: 'taco', dish_name: 'Taco', liked: true, note: 'Lovely', date: new Date().toISOString() }]);
      for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 1);
    });
    await t.test('another signed-in user cannot read, overwrite or delete private rows', async () => {
      await identity(B);
      for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      assert.equal((await db.query('update taste_profiles set document=$1 where user_id=$2 returning id', [document, A])).rows.length, 0);
      await assert.rejects(db.query('delete from taste_profiles where user_id=$1', [A]), /permission denied/);
      await assert.rejects(db.query('insert into taste_profiles(user_id, document) values ($1, $2)', [A, document]), /row-level security/);
      await db.query('insert into taste_profiles(document) values ($1)', [document]);
      await assert.rejects(db.query('update taste_profiles set user_id=$1', [A]), /permission denied/);
    });
    await t.test('foreign keys cannot link another user’s recommendation or dining event', async () => {
      await assert.rejects(db.query("insert into dining_events(event_type, restaurant_id, menu_version, dish_id, occurred_at, recommendation_id) values ('selected','casa-sol','v1','taco',now(),$1)", [H]), /foreign key/);
      await assert.rejects(db.query('insert into dish_feedback(event_id, feedback) values ($1, $2)', [E,
        { id: 'foreign', restaurant_name: 'Casa Sol', dish_id: 'taco', dish_name: 'Taco', liked: true, note: '', date: new Date().toISOString() }]), /foreign key/);
    });
    await t.test('unauthenticated requests have no read or write access', async () => {
      await identity('', 'anon');
      for (const table of tables) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      await assert.rejects(db.query('insert into taste_profiles(document) values ($1)', [document]), /permission denied/);
      await identity(''); // Missing auth.uid() must also fail for the authenticated role.
      assert.equal((await db.query('select * from taste_profiles')).rows.length, 0);
      await assert.rejects(db.query('insert into taste_profiles(document) values ($1)', [document]));
    });
    await t.test('profile revisions prevent lost updates and duplicate inserts never upsert', async () => {
      await identity(A);
      const before = (await db.query('select * from taste_profiles')).rows[0];
      const updated = (await db.query('update taste_profiles set document=$1 where revision=1 returning *', [{ ...document, exploration_edited: true }])).rows[0];
      assert.equal(updated.revision, 2);
      assert.equal(new Date(updated.created_at).getTime(), new Date(before.created_at).getTime());
      assert.equal(updated.id, before.id);
      assert.equal((await db.query('update taste_profiles set document=$1 where revision=1 returning *', [document])).rows.length, 0);
      await assert.rejects(db.query('insert into taste_profiles(document) values ($1)', [document]), /duplicate key/);
    });
    await t.test('schema constraints reject invalid records, append-only histories cannot be altered', async () => {
      await assert.rejects(db.query('update taste_profiles set document=$1', [[]]), /check constraint/);
      await assert.rejects(db.query("insert into dining_events(event_type, restaurant_id, menu_version, dish_id, occurred_at) values ('invented','x','v1','x',now())"), /check constraint/);
      await assert.rejects(db.query('insert into dish_feedback(feedback, rating) values ($1, 6)', [{ id: 'bad', restaurant_name: 'x', dish_id: 'x', dish_name: 'x', liked: true, note: '', date: new Date().toISOString() }]), /check constraint/);
      for (const table of tables.slice(1)) await assert.rejects(db.query(`update ${table} set source='user_reported'`), /permission denied/);
    });
    await t.test('4D.2B migration preserves existing DNA and adds owner-only corrections/deletion', async () => {
      const before = (await db.query('select * from taste_profiles')).rows;
      await db.exec('reset role');
      await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202610290001_dining_memory.sql'), 'utf8'));
      await identity(A);
      assert.deepEqual((await db.query('select * from taste_profiles')).rows, before);
      const updated = (await db.query("update dining_events set event_type='ordered' where id=$1 and revision=1 returning *", [E])).rows[0];
      assert.equal(updated.revision, 2); assert.equal(updated.event_type, 'ordered');
      assert.equal((await db.query("update dining_events set event_type='saved' where id=$1 and revision=1 returning *", [E])).rows.length, 0);
      await assert.rejects(db.query("update dining_events set dish_id='fabricated' where id=$1", [E]), /permission denied/);
      await assert.rejects(db.query("update dish_feedback set feedback=jsonb_set(feedback,'{dish_id}','\"fabricated\"') where id=$1", [F]), /provenance is immutable/);
      const rating = (await db.query("update dish_feedback set feedback=jsonb_set(feedback,'{note}','\"Less sweet\"'), rating=4 where id=$1 and revision=1 returning *", [F])).rows[0];
      assert.equal(rating.revision, 2); assert.equal(rating.feedback.note, 'Less sweet');
      await identity(B);
      for (const [table,id] of [['dining_events',E],['dish_feedback',F]]) {
        assert.equal((await db.query(`delete from ${table} where id=$1 returning id`, [id])).rows.length, 0);
        assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      }
      assert.equal((await db.query("update dining_events set event_type='saved' where id=$1 returning id", [E])).rows.length, 0);
      await identity('', 'anon');
      await assert.rejects(db.query('delete from dining_events where id=$1', [E]), /permission denied/);
      await identity(A);
      await assert.rejects(db.query('delete from dining_events where id=$1', [E]), /foreign key/);
      assert.equal((await db.query('delete from dish_feedback where id=$1 and revision=2 returning id', [F])).rows.length, 1);
      assert.equal((await db.query('delete from dining_events where id=$1 and revision=2 returning id', [E])).rows.length, 1);
      assert.deepEqual((await db.query('select * from taste_profiles')).rows, before);
      await assert.rejects(db.query('delete from taste_profiles'), /permission denied/);
    });
  } finally { await db.close(); }
});
