const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { DiningJournal, memoryId, actionRecords } = require('../lib/memory/journal.ts');
const { restoreTasteDocument, profileFingerprint } = require('../lib/memory/restore.ts');
const { initialState } = require('../lib/storage.ts');
const { tasteDocument } = require('../lib/memory-repository.ts');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const H='33333333-3333-4333-8333-333333333333', E='44444444-4444-4444-8444-444444444444', F='55555555-5555-4555-8555-555555555555';
const NOW='2026-10-29T12:00:00Z';
const history={id:H,session_id:'session',restaurant_id:'casa-sol',menu_version:'v1',dishes:[],reported_provider:'demo'};
const event={id:E,event_type:'saved',restaurant_id:'casa-sol',restaurant_name:'Casa Sol',dish_name:'Taco',menu_version:'v1',dish_id:'taco',occurred_at:NOW,recommendation_id:H};
const feedback={id:F,event_id:E,rating:5,tags:['great_texture'],feedback:{id:'rating',restaurant_id:'casa-sol',restaurant_name:'Casa Sol',dish_id:'taco',dish_name:'Taco',menu_version:'v1',liked:true,note:'Smoky but too sweet',date:NOW}};
function fixture() {
  const values=new Map(); const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const db={events:[],feedback:[],history:[]}; const calls=[]; let fail=false;
  const repo={};
  for(const [kind,method] of [['events','addEvent'],['feedback','addFeedback'],['history','addHistory']]) {
    repo[kind]=async()=>({records:structuredClone(db[kind])});
    repo[method]=async value=>{calls.push(method);if(fail)throw Error('Offline cloud save');let row=db[kind].find(r=>r.id===value.id);if(!row){row={...structuredClone(value),user_id:A,source:'user_reported',created_at:NOW,updated_at:NOW,...(kind==='history'?{}:{revision:1})};db[kind].push(row);}return structuredClone(row);};
  }
  repo.correctEvent=async(id,value)=>{const row=db.events.find(r=>r.id===id);assert.equal(row.revision,value.expected_revision);row.event_type=value.event_type;row.revision++;return structuredClone(row);};
  repo.correctFeedback=async(id,value)=>{const row=db.feedback.find(r=>r.id===id);assert.equal(row.revision,value.expected_revision);row.feedback={...row.feedback,liked:value.liked,note:value.note};row.rating=value.rating;row.tags=value.tags;row.revision++;return structuredClone(row);};
  repo.deleteRecord=async(kind,id)=>{db[kind]=db[kind].filter(r=>r.id!==id);return{id,deleted:true};};
  return{storage,values,db,calls,repo,fail:value=>{fail=value;},store:()=>new DiningJournal(A,storage,repo,()=>{})};
}
test('stable owner/session/action UUIDs distinguish actions and accounts',async()=>{
  assert.equal(await memoryId(A+':s:saved'),await memoryId(A+':s:saved'));
  assert.notEqual(await memoryId(A+':s:saved'),await memoryId(A+':s:tasted'));
  assert.notEqual(await memoryId(A+':s:saved'),await memoryId(B+':s:saved'));
  await assert.rejects(actionRecords(A,{recommendations:[],worth_the_stretch:null},{dish:{id:'fake'}},'saved'),/no longer/);
});
test('saving interest does not fabricate ordering, consumption or a rating',async()=>{
  const f=fixture(),store=f.store();await store.record(history,event);
  assert.deepEqual(f.db.events.map(e=>e.event_type),['saved']);assert.equal(f.db.feedback.length,0);
  assert.equal(store.data.events[0].status,'synced');
});
test('failed cloud writes stay durable; reload does not auto-upload; explicit retries do not duplicate',async()=>{
  const f=fixture();f.fail(true);const store=f.store();
  await assert.rejects(store.record(history,{...event,event_type:'tasted'},feedback),/Offline/);
  assert.equal(store.data.feedback[0].status,'pending');const before=f.calls.length;
  const again=f.store();assert.equal(f.calls.length,before);assert.equal(again.data.feedback[0].value.feedback.note,feedback.feedback.note);
  f.fail(false);await Promise.all([again.sync(),again.sync()]);
  await again.record(history,{...event,event_type:'tasted'},feedback);
  assert.deepEqual(Object.values(f.db).map(v=>v.length),[1,1,1]);
});
test('records survive cache reload and server retrieval; another identity has an isolated cache',async()=>{
  const f=fixture();await f.store().record(history,event,feedback);const again=f.store();await again.refresh();
  assert.equal(again.data.feedback[0].value.rating,5);
  assert.equal(new DiningJournal(B,f.storage,null,()=>{}).data.feedback.length,0);
});
test('local-only actions persist without network and explicit import retains legacy uncertainty',async()=>{
  const f=fixture(),local=new DiningJournal('local',f.storage,null,()=>{});await local.record(history,event,feedback);
  assert.equal(f.calls.length,0);assert.equal(local.data.events[0].status,'local');
  const cloud=f.store();await cloud.importBrowserRecords();assert.equal(f.db.events.length,1);assert.notEqual(f.db.events[0].id,E);
  assert.equal(f.db.feedback[0].event_id,f.db.events[0].id);
  await cloud.importBrowserRecords();assert.equal(f.db.feedback.length,1);
  await cloud.importLegacy([{...feedback.feedback,id:'legacy'}]);
  assert.equal(f.db.feedback.find(r=>r.feedback.id==='legacy').event_id,null);
});
test('correction and deletion retain provenance and remove only the selected records',async()=>{
  const f=fixture(),store=f.store();await store.record(history,event,feedback);
  await store.correct('events',store.data.events[0],{expected_revision:1,event_type:'ordered'});
  await store.correct('feedback',store.data.feedback[0],{expected_revision:1,liked:false,note:'Correction',rating:2,tags:[]});
  assert.equal(f.db.events[0].revision,2);assert.equal(f.db.feedback[0].feedback.menu_version,'v1');
  await assert.rejects(store.remove('events',store.data.events[0]),/linked rating/);
  await store.remove('feedback',store.data.feedback[0]);await store.remove('events',store.data.events[0]);
  assert.equal(f.db.feedback.length,0);assert.equal(f.db.events.length,0);assert.equal(f.db.history.length,1);
});
test('storage failure cannot be claimed as a durable local save',async()=>{
  const f=fixture();f.storage.setItem=()=>{throw Error('full');};
  await assert.rejects(f.store().record(history,event),/has not been saved/);assert.equal(f.calls.length,0);
});
test('late requests after identity disposal cannot publish or upload dependent records',async()=>{
  const f=fixture();let release;f.repo.addHistory=()=>new Promise(resolve=>{release=resolve;});const store=f.store();
  const pending=store.record(history,event);store.dispose();release({...history,user_id:A});
  await assert.rejects(pending,/session changed/);assert.equal(f.db.events.length,0);
  const before=f.values.get(store.key);await store.refresh();assert.equal(f.values.get(store.key),before);
});
test('refresh never replaces conflicting pending feedback',async()=>{
  const f=fixture();f.fail(true);const store=f.store();await assert.rejects(store.record(history,event,feedback));
  f.db.feedback=[{...feedback,feedback:{...feedback.feedback,note:'other tab'},user_id:A,created_at:NOW,updated_at:NOW,source:'user_reported',revision:1}];
  await store.refresh();assert.equal(store.data.feedback[0].value.feedback.note,feedback.feedback.note);assert.match(store.error,/differs/);
});
test('safe explicit restore preserves feedback, temporary preferences and hard safeguards',()=>{
  const state=initialState();state.taste.favorites='local';state.feedback=[feedback.feedback];state.constraints.max_price_minor=1234;state.constraints.allergies.allergens=['peanuts'];
  state.selection={restaurant_id:'casa-sol',menu_version:'v1'};
  const cloud=initialState();cloud.taste.complete=true;cloud.taste.favorites='cloud';cloud.taste.allergies.allergens=['milk'];
  const restored=restoreTasteDocument(state,tasteDocument(cloud),profileFingerprint(state));
  assert.equal(restored.taste.favorites,'cloud');assert.equal(restored.constraints.max_price_minor,1234);assert.deepEqual(restored.feedback,state.feedback);
  assert.deepEqual(restored.taste.allergies.allergens,['peanuts','milk']);assert.equal(restored.selection,null);assert.equal(state.taste.favorites,'local');
  assert.throws(()=>restoreTasteDocument({...state,taste:{...state.taste,favorites:'edited'}},tasteDocument(cloud),profileFingerprint(state)),/changed/);
  const unsupported=tasteDocument(cloud);unsupported.evidence.favorite_dishes=['ramen'];assert.throws(()=>restoreTasteDocument(state,unsupported,profileFingerprint(state)),/evidence/);
});
test('relay restricts PATCH/DELETE to record routes and preserves cross-origin protection',async t=>{
  const original=global.fetch;t.after(()=>global.fetch=original);const {NextRequest}=require('next/server'),relay=require('../app/api/dinetuned/[...path]/route.ts');
  let seen;global.fetch=async(url,options)=>{seen={url,options};return Response.json({id:E,deleted:true});};
  const headers={Authorization:'Bearer offline.test.signature'},context={params:Promise.resolve({path:['memory','events',E]})};
  const url='http://localhost:3000/api/dinetuned/memory/events/'+E+'?expected_revision=2';
  assert.equal((await relay.DELETE(new NextRequest(url,{method:'DELETE',headers}),context)).status,200);assert.ok(seen.url.endsWith('expected_revision=2'));
  assert.equal((await relay.PATCH(new NextRequest(url,{method:'PATCH',headers:{...headers,Origin:'https://wrong.example'}}),context)).status,403);
  assert.equal((await relay.DELETE(new NextRequest(url,{method:'DELETE',headers}),{params:Promise.resolve({path:['memory','profile']})})).status,404);
});

test('deletion acknowledgements must match the requested record and retain fresh identity checks',async t=>{
  const previous=global.fetch;t.after(()=>global.fetch=previous);
  const {CloudMemoryRepository}=require('../lib/memory-repository.ts');
  global.fetch=async()=>Response.json({id:B,deleted:true});
  const repo=new CloudMemoryRepository(async()=>({token:'offline.test.signature',userId:A}));
  await assert.rejects(repo.deleteRecord('events',E,1),/does not match/);
  global.fetch=async()=>Response.json({id:E,deleted:true});let calls=0;
  const changed=new CloudMemoryRepository(async()=>({token:'offline.test.signature',userId:++calls===1?A:B}));
  await assert.rejects(changed.deleteRecord('events',E,1),/identity changed/);
});
