import { test, expect, type Page } from '@playwright/test';
import { returningUser } from './session-helpers';
import { initialState, STORAGE_KEY } from '../../lib/storage';
import { tasteDocument } from '../../lib/memory-repository';

const USER = '11111111-1111-4111-8111-111111111111', PROJECT = 'https://offline-project.supabase.co';
const NOW = '2026-10-29T12:00:00Z';
async function cloud(page: Page) {
  await page.route('https://**', route => route.abort());
  const database: Record<string, any[]> = { events: [], feedback: [], history: [] };
  const state = initialState(); state.taste.complete = true; state.taste.favorites = 'My cloud favorite';
  let backup = { id: USER, user_id: USER, document: tasteDocument(state), revision: 1, source: 'user_reported', created_at: NOW, updated_at: NOW };
  let profileWrites = 0, failEvents = false, delayProfile: (() => Promise<void>) | null = null;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: NOW, app_metadata: {}, user_metadata: {}, identities: [] };
  const token = [Buffer.from(JSON.stringify({ alg:'HS256',typ:'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub:USER,exp,aud:'authenticated',role:'authenticated',is_anonymous:true })).toString('base64url'), 'offline-signature'].join('.');
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode:'supabase',url:PROJECT,publishable_key:'sb_publishable_offline_test_key_only_12345' } }));
  await page.route(`${PROJECT}/auth/v1/**`, route => {
    if (route.request().url().endsWith('/signup')) return route.fulfill({ json: { access_token:token,refresh_token:'offline-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user } });
    if (route.request().url().endsWith('/user')) return route.fulfill({ json:user });
    return route.abort();
  });
  await page.route('**/api/dinetuned/memory/**', async route => {
    const request=route.request(),url=new URL(request.url()),[resource,id]=url.pathname.split('/memory/')[1].split('/');
    expect(request.headers().authorization).toBe('Bearer '+token);
    if(resource==='profile') {
      if(request.method()!=='GET') { profileWrites++; return route.fulfill({ status:409,json:{detail:'Test backup is immutable'} }); }
      if(delayProfile) await delayProfile();
      return route.fulfill({json:{profile:backup}});
    }
    if(!(resource in database)) return route.fulfill({status:404,json:{detail:'unknown'}});
    if(request.method()==='GET') return route.fulfill({json:{records:database[resource].slice(Number(url.searchParams.get('offset') || 0),50)}});
    if(request.method()==='POST') {
      if(failEvents && resource==='events') return route.fulfill({status:503,json:{detail:'offline'}});
      const body=request.postDataJSON(); expect(body.user_id).toBeUndefined();
      let row=database[resource].find(item=>item.id===body.id);
      if(!row) {row={...body,user_id:USER,source:'user_reported',created_at:NOW,updated_at:NOW,...(resource==='history'?{}:{revision:1})};database[resource].push(row);}
      return route.fulfill({status:201,json:row});
    }
    const index=database[resource].findIndex(row=>row.id===id), row=database[resource][index];
    const revision=request.method()==='DELETE'?Number(url.searchParams.get('expected_revision')):request.postDataJSON().expected_revision;
    if(!row || row.revision!==revision) return route.fulfill({status:409,json:{detail:'revision conflict'}});
    if(request.method()==='DELETE') {database[resource].splice(index,1);return route.fulfill({json:{id,deleted:true}});}
    const body=request.postDataJSON();
    if(resource==='events') row.event_type=body.event_type;
    else {row.feedback={...row.feedback,liked:body.liked,note:body.note};row.rating=body.rating;row.tags=body.tags;}
    row.revision++;return route.fulfill({json:row});
  });
  return { database, profileWrites:()=>profileWrites, fail:(value:boolean)=>{failEvents=value;}, changeBackup:()=>{backup={...backup,revision:backup.revision+1};}, delay:(callback:()=>Promise<void>)=>{delayProfile=callback;} };
}
async function picks(page:Page) {
  await returningUser(page); await page.goto('/restaurant/saigon-table');
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await page.locator('.menu-picks-top button').click();
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  const card=page.locator('.signature-pick').first();await expect(card.getByRole('button',{name:'Save dish',exact:true})).toBeEnabled();return card;
}

test('dining actions persist distinctly; confirmed feedback can be corrected and deleted', async ({page},info)=>{
  const f=await cloud(page),card=await picks(page);
  for(const label of ['Save dish','Select dish','I ordered this']) {await card.getByRole('button',{name:label,exact:true}).click();await expect(card.getByRole('status')).toContainText('Saved to your private');}
  expect(f.database.events.map(row=>row.event_type)).toEqual(['saved','selected','ordered']);expect(f.database.feedback).toHaveLength(0);
  await card.locator('.feedback-sheet summary').click();await expect(card.getByRole('button',{name:'Loved it',exact:true})).toBeDisabled();
  await card.getByLabel('I confirm I tried this dish').check();await card.getByLabel('Your rating').selectOption('5');
  await card.getByLabel('What stood out?').fill('Loved the smoky flavor but disliked the sweetness');await card.getByRole('button',{name:'Great texture',exact:true}).click();
  await card.getByRole('button',{name:'Loved it',exact:true}).click();await expect(card.getByRole('status')).toContainText('Saved to your private');
  expect(f.database.events.map(row=>row.event_type)).toEqual(['saved','selected','ordered','tasted']);expect(f.database.feedback).toHaveLength(1);expect(f.database.history).toHaveLength(1);
  await page.goto('/memory');await expect(page.getByText('5 / 5',{exact:false})).toBeVisible();
  await page.reload();await expect(page.getByText('Guest identity connected.',{exact:false})).toBeVisible();
  await expect(page.locator('.dining-record')).toHaveCount(5);
  await expect(page.getByText('Loved the smoky flavor but disliked the sweetness',{exact:false})).toBeVisible();
  if(info.project.name==='mobile') await page.setViewportSize({width:320,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`dining-${info.project.name}.png`),fullPage:true});
  const rating=page.locator(`[data-record-id="${f.database.feedback[0].id}"]`);
  await rating.getByRole('button',{name:'Correct record'}).click();await rating.getByLabel('Your original observations').fill('Still smoky; corrected my sweetness note');
  await rating.getByRole('combobox',{name:'Rating',exact:true}).selectOption('4');await rating.getByRole('button',{name:'Save correction'}).click();
  await expect(rating).toContainText('4 / 5');expect(f.database.feedback[0].revision).toBe(2);
  await rating.getByRole('button',{name:'Delete record'}).click();await rating.getByRole('button',{name:'Confirm delete'}).click();await expect(rating).toHaveCount(0);
  expect(f.database.feedback).toHaveLength(0);await page.reload();await expect(page.locator('.dining-record')).toHaveCount(4);
  const saved=page.locator(`[data-record-id="${f.database.events[0].id}"]`);await saved.getByRole('button',{name:'Correct record'}).click();
  await saved.getByLabel('Correct dining action').selectOption('selected');await saved.getByRole('button',{name:'Save correction'}).click();await expect(saved.locator('.memory-item-date')).toContainText('Selected');
  await saved.getByRole('button',{name:'Delete record'}).click();await saved.getByRole('button',{name:'Confirm delete'}).click();await expect(saved).toHaveCount(0);expect(f.profileWrites()).toBe(0);
});

test('pending saves survive reload and retry without duplicate events',async({page})=>{
  const f=await cloud(page);f.fail(true);const card=await picks(page);
  await card.getByRole('button',{name:'Save dish',exact:true}).click();await expect(card.getByRole('status')).toContainText('unavailable');
  await page.goto('/memory');await expect(page.getByText('Saved locally · cloud save pending')).toBeVisible();await page.reload();
  await expect(page.getByRole('button',{name:'Retry pending cloud saves'})).toBeVisible();expect(f.database.events).toHaveLength(0);
  f.fail(false);await page.getByRole('button',{name:'Retry pending cloud saves'}).click();await expect(page.getByText('Private cloud record',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh dining history'}).click();expect(f.database.events).toHaveLength(1);expect(f.database.history).toHaveLength(1);expect(f.profileWrites()).toBe(0);
});

test('restore requires explicit confirmation and rejects changing cloud revisions',async({page})=>{
  const f=await cloud(page);await returningUser(page);await page.goto('/memory');
  await expect(page.getByRole('button',{name:'Restore cloud Taste DNA'})).toBeEnabled();
  const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),STORAGE_KEY);
  await page.getByRole('button',{name:'Restore cloud Taste DNA'}).click();await page.getByRole('button',{name:'Cancel restore'}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).taste,STORAGE_KEY)).toEqual(before.taste);
  await page.getByRole('button',{name:'Restore cloud Taste DNA'}).click();f.changeBackup();await page.getByRole('button',{name:'Confirm restore'}).click();
  await expect(page.getByRole('status')).toContainText('cloud backup changed');expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).taste,STORAGE_KEY)).toEqual(before.taste);
  await page.getByRole('button',{name:'Restore cloud Taste DNA'}).click();await page.getByRole('button',{name:'Confirm restore'}).click();await expect(page.getByRole('status')).toContainText('Cloud Taste DNA restored');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).taste.favorites,STORAGE_KEY)).toBe('My cloud favorite');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key+'-before-cloud-restore')!).taste,STORAGE_KEY)).toEqual(before.taste);
  await page.reload();await expect(page.getByText(/revision 2/)).toBeVisible();expect(f.profileWrites()).toBe(0);
});
