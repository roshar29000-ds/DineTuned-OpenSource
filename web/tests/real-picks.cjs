const fs = require('node:fs'), ts = require('typescript');
const { test } = require('node:test'), assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { realPersonalizedPicks, realPicksCapability } = require('../lib/real-picks.ts');
const { realActionRecords } = require('../lib/real-picks-memory.ts');
const fixture = require('./fixtures/real-picks.json');
const { NextRequest } = require('next/server');
const relay = require('../app/api/dinetuned/[...path]/route.ts');
const signal = () => new AbortController().signal;
function mock(t, fn) { const old=global.fetch; t.after(()=>{global.fetch=old;}); global.fetch=fn; }

test('real Picks use current authenticated extraction and preserve backend prices and source evidence', async t => {
  let calls=0;
  mock(t, async (url,init)=> {
    calls++; assert.equal(url,'/api/dinetuned/real-picks/sessions'); assert.equal(init.headers.Authorization,'Bearer offline.test.signature');
    assert.deepEqual(JSON.parse(init.body),fixture.request); return Response.json(fixture.response);
  });
  const result=await realPersonalizedPicks(fixture.request,async()=>'offline.test.signature',signal());
  assert.equal(result.mode,'mock'); assert.deepEqual(result.recommendations.map(p=>p.budget.overage_minor),[0,0,200]); assert.equal(calls,1);
});

test('missing verification and pre-cancelled requests do not dispatch', async t => {
  let calls=0;mock(t,async()=>{calls++;return Response.json(fixture.response);});
  const req=structuredClone(fixture.request);req.extraction.recommendation_token=null;
  await assert.rejects(realPersonalizedPicks(req,async()=>'offline.test.signature',signal()),/verified snapshot/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(realPersonalizedPicks(fixture.request,async()=>'offline.test.signature',abort.signal));assert.equal(calls,0);
});

test('stale requests, fabricated menu fields, duplicate picks and wrong overages never reach the UI', async t => {
  const changes=[r=>r.request_id='33333333-3333-4333-8333-333333333333',r=>r.restaurant_id='other',r=>r.menu_version='old',
    r=>r.recommendations[0].dish.name='Invented',r=>r.recommendations[0].dish.description='Invented cream sauce',
    r=>r.recommendations[0].price_minor=1,r=>r.recommendations[2].budget.overage_minor=1,
    r=>r.recommendations[1]=r.recommendations[0],r=>r.recommendations[0].connections[0].evidence.source_hash='a'.repeat(64),
    r=>r.recommendations[0].connections[0].menu_quote='Rice',r=>r.mode='demo',r=>r.status='no_matches'];
  for(const change of changes) {
    const result=structuredClone(fixture.response);change(result);mock(t,async()=>Response.json(result));
    await assert.rejects(realPersonalizedPicks(fixture.request,async()=>'offline.test.signature',signal()));
  }
});

test('hidden overages, errors and late cancelled results fail honestly without retries', async t => {
  const req=structuredClone(fixture.request);req.options.include_over_budget=false;
  mock(t,async()=>Response.json(fixture.response));
  await assert.rejects(realPersonalizedPicks(req,async()=>'offline.test.signature',signal()));
  let calls=0;mock(t,async()=>{calls++;return Response.json({detail:'Provider unavailable'},{status:503});});
  await assert.rejects(realPersonalizedPicks(fixture.request,async()=>'offline.test.signature',signal()),/Provider unavailable/);assert.equal(calls,1);
  const abort=new AbortController();mock(t,async()=>{abort.abort();return Response.json(fixture.response);});
  await assert.rejects(realPersonalizedPicks(fixture.request,async()=>'offline.test.signature',abort.signal));
});

test('capability and relay cannot expose credentials or unauthenticated POST', async t => {
  mock(t,async()=>Response.json({available:false,mode:'disabled',message:'Approval required'}));
  assert.equal((await realPicksCapability(signal())).available,false);
  const ctx={params:Promise.resolve({path:['real-picks','sessions']})};
  assert.equal((await relay.POST(new NextRequest('http://localhost:3000/api/dinetuned/real-picks/sessions',{method:'POST'}),ctx)).status,401);
  assert.equal((await relay.POST(new NextRequest('http://localhost:3000/api/dinetuned/real-picks/sessions',{method:'POST',headers:{Authorization:'Bearer offline.test.signature',Origin:'https://wrong.example'}}),ctx)).status,403);
  assert.equal((await relay.GET(new NextRequest('http://localhost:3000/api/dinetuned/real-picks/sessions'),ctx)).status,404);
});

test('real bridge, pairing, stretch and refinement responses stay bound to this source menu', async t => {
  const request=structuredClone(fixture.request), response=structuredClone(fixture.response);
  const [main, side, stretch]=response.recommendations;
  response.recommendations=[main]; response.worth_the_stretch=[stretch];
  response.taste_bridges=[{item_id:main.dish.id,anchor:main.connections[0].preference,
    menu_quote:main.connections[0].menu_quote,evidence:main.connections[0].evidence,
    connection:'Source-linked taste connection.',uncertainty:'Subjective match.'}];
  response.meal_combinations=[{main_item_id:main.dish.id,additions:[{dish:side.dish,category_name:side.category_name,
    price_minor:side.price_minor,evidence:side.connections[0].evidence}],subtotal_minor:main.price_minor+side.price_minor,
    rationale:'Mocked provider proposal.',limitations:['Availability is unverified.']}];
  mock(t,async()=>Response.json(response));
  const valid=await realPersonalizedPicks(request,async()=>'offline.test.signature',signal());
  assert.equal(valid.meal_combinations[0].subtotal_minor,3400);
  assert.equal(valid.worth_the_stretch[0].budget.overage_minor,200);
  for(const mutate of [
    r=>r.meal_combinations[0].subtotal_minor++,
    r=>r.meal_combinations[0].additions[0].dish.name='fabricated',
    r=>r.meal_combinations[0].additions[0].evidence.source_hash='a'.repeat(64),
    r=>r.taste_bridges[0].menu_quote='invented ingredient',
    r=>r.worth_the_stretch=[r.recommendations[0]],
  ]) {
    const altered=structuredClone(response);mutate(altered);mock(t,async()=>Response.json(altered));
    await assert.rejects(realPersonalizedPicks(request,async()=>'offline.test.signature',signal()));
  }
  request.refinements.avoid_dish_ids=[main.dish.id];
  mock(t,async()=>Response.json(response));
  await assert.rejects(realPersonalizedPicks(request,async()=>'offline.test.signature',signal()));
});

test('real dish actions reuse stable private history IDs without implying consumption', async () => {
  const result=fixture.response, pick=result.recommendations[0];
  const one=await realActionRecords('offline-user',result,'Orchard Kitchen',pick,'saved');
  const again=await realActionRecords('offline-user',result,'Orchard Kitchen',pick,'saved');
  const tried=await realActionRecords('offline-user',result,'Orchard Kitchen',pick,'tasted');
  assert.equal(one.event.id,again.event.id); assert.notEqual(one.event.id,tried.event.id);
  assert.equal(one.history.id,tried.history.id); assert.equal(one.event.event_type,'saved');
  assert.equal(one.event.menu_version,result.menu_version);
  assert.equal(one.history.reported_provider,'mock');
  assert.equal(one.history.dishes[0].price.amount_minor,pick.price_minor);
  await assert.rejects(realActionRecords('offline-user',result,'Orchard Kitchen',{dish:{id:'invented'}},'saved'),/no longer/);
});
