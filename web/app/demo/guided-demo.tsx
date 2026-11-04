'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import fixture from '../../tests/fixtures/picks-preview.json';
import type { MenuExtractionResult, RefinementRequest, TasteProfile } from '../../lib/contracts';
import { initialConstraints } from '../../lib/preferences';
import { emptyRefinements } from '../../lib/refinements';
import { isContract } from '../../lib/validation';
import { useDineTuned } from '../../components/AppProvider';
import { Brand, Eyebrow, Icon } from '../../components/UI';
import { TasteDetective } from '../../components/taste/TasteDetective';
import { TasteDNA } from '../../components/taste/TasteDNA';
import { RealRestaurantMenu } from '../../components/menu-retrieval/RealRestaurantMenu';
import { DietaryControls, AllergyControls } from '../../components/menu/PreferenceControls';
import { CulinaryOrbit, ORBIT_HANDOFF_MS, sceneFromMenu } from '../../components/menu-retrieval/MuseLoading';
import type { PreviewExperienceState } from '../../components/menu-retrieval/PreviewDishExperience';
import { PicksPreview } from '../picks-preview/preview';
import { enterDemoExplore } from '../../lib/demo-session';

type Stage = 'welcome' | 'detective' | 'taste' | 'restaurant' | 'menu' | 'kitchen' | 'picks' | 'memory';
const steps: Stage[] = ['welcome', 'detective', 'taste', 'restaurant', 'menu', 'kitchen', 'picks', 'memory'];
const storeKey = 'dinetuned-guided-demo-journey';
const extraction = fixture.extraction as MenuExtractionResult;
const sampleProfile = { ...(fixture.profile as TasteProfile), complete: true };
const sampleTarget = fixture.result.recommendations[0]?.budget.target_minor ?? 2200;

function KitchenReplay({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), ready ? 0 : 11000);
    const done = ready ? setTimeout(onDone, ORBIT_HANDOFF_MS) : undefined;
    return () => { clearTimeout(timer); if (done) clearTimeout(done); };
  }, [ready, onDone]);
  const scene = { ...sceneFromMenu(extraction, sampleProfile, 'mock'), preview: true };
  return <div className="guided-demo-kitchen"><CulinaryOrbit scene={scene} ready={ready} onLeave={onBack} onSkip={onDone}/></div>;
}

export function GuidedDemo() {
  const app = useDineTuned();
  const [stage, setStage] = useState<Stage>('welcome');
  const [sample, setSample] = useState(false);
  const [history, setHistory] = useState<Record<string, PreviewExperienceState>>({});
  const [refinements, setRefinements] = useState<RefinementRequest>(emptyRefinements);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storeKey) || '{}') as { stage?: Stage; sample?: boolean; history?: Record<string, PreviewExperienceState>; refinements?: unknown };
      if (saved.stage && steps.includes(saved.stage)) setStage(['restaurant', 'menu', 'kitchen', 'picks', 'memory'].includes(saved.stage) ? 'taste' : saved.stage);
      if (saved.sample === true) setSample(true);
      if (saved.history && typeof saved.history === 'object' && !Array.isArray(saved.history)) setHistory(saved.history);
      if (isContract<RefinementRequest>('RefinementRequest', saved.refinements)) setRefinements(saved.refinements);
    } catch { /* An invalid demo snapshot starts fresh. Guest data is never read. */ }
    setRestored(true);
  }, []);
  useEffect(() => { if (restored) try { sessionStorage.setItem(storeKey, JSON.stringify({ stage, sample, history, refinements })); } catch { /* Demo remains usable without storage. */ }
  }, [stage, sample, history, refinements, restored]);
  const go = (next: Stage) => { setStage(next); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const useSample = () => { app.setTaste(sampleProfile); app.setConstraints({ ...initialConstraints(), max_price_minor: sampleTarget }); setSample(true); go('taste'); };
  const restart = () => { app.reset(); setHistory({}); setRefinements(emptyRefinements()); setSample(false); go('welcome'); };
  const record = (dishId: string, value: PreviewExperienceState) => setHistory(previous => ({ ...previous, [dishId]: value }));
  const hasStrict = !!app.constraints.dietary_restrictions.length || !!app.constraints.allergies.allergens.length || !!app.constraints.allergies.other.trim();
  const sampleReady = sample && app.constraints.max_price_minor === sampleTarget && !hasStrict;
  const allPicks = [...fixture.result.recommendations, ...(fixture.result.worth_the_stretch || [])];
  if (!restored) return <main className="content-width page-padding" role="status">Preparing the offline demonstration…</main>;
  return <div className="guided-demo">
    {stage !== 'kitchen' && <header className="guided-demo-header content-width"><Brand/><span>FICTIONAL, OFFLINE DEMONSTRATION · NO GUEST DATA OR PROVIDER CALLS</span>
      <button type="button" onClick={restart}>Restart demo</button></header>}
    {stage === 'welcome' && <main className="content-width page-padding guided-demo-welcome"><div><Eyebrow>TRY DINETUNED · OFFLINE</Eyebrow><h1>A table set for <em>discovery.</em></h1>
      <p>Experience the complete dining journey with your answers or a sample palate, six fictional restaurants, and the original DineTuned menu and Picks pages. No Google or paid AI call is needed.</p>
      <div className="guided-demo-actions"><button type="button" className="button button-primary" onClick={() => go('detective')}>Meet Taste Detective <Icon name="arrow" size={17}/></button>
        <button type="button" className="button button-outline" onClick={useSample}>Use a clearly labeled sample palate</button></div>
      <p className="guided-demo-honesty">Your answers shape offline Picks from each fictional menu. A sample palate is available if you want to get to the table sooner.</p></div>
      <div className="guided-demo-welcome-photo"><img src="/picks-preview/mushroom-rice.jpg" alt="AI-generated illustration of a fictional mushroom rice dish, not restaurant photography"/>
        <span>Illustration of a fictional dish · actual restaurant photography is not implied</span></div></main>}
    {stage === 'detective' && <TasteDetective onDemoBack={() => go('welcome')} onDemoComplete={() => { setSample(false); go('taste'); }}/>}
    {stage === 'taste' && <><div className="guided-demo-context content-width">{sample ? 'Sample palate · fictional offline demonstration.' : 'Your demo answers are private to this tab and guide your fictional menu Picks.'}</div>
      <TasteDNA demoNavigation={{ revisit: () => go('detective'), explore: enterDemoExplore }}/></>}
    {stage === 'restaurant' && <main className="content-width page-padding guided-demo-restaurant"><Eyebrow>CHOOSE A TABLE</Eyebrow><h1>A menu to <em>explore.</em></h1>
      <p>This fictional venue and its complete seven-dish menu are original demonstration data. No Google Places request is made.</p>
      <button type="button" className="guided-demo-restaurant-card" onClick={() => go('menu')}><img src="/picks-preview/roasted-tomato-soup.jpg" alt="AI-generated illustration of a fictional tomato soup"/>
        <span><small>FICTIONAL RESTAURANT · OFFLINE</small><strong>{extraction.menu.restaurant.display_name}</strong><span>{extraction.menu.total_items} sample dishes · {extraction.menu.categories.length} categories</span><b>Explore the complete menu →</b></span></button>
      <Link href="/discover">Explore real restaurants separately</Link></main>}
    {stage === 'menu' && <main className="content-width page-padding guided-demo-menu"><div className="guided-demo-context">FICTIONAL MENU · {sample ? 'SAMPLE PALATE' : 'YOUR DEMO ANSWERS'} · NO EXTERNAL REQUESTS</div>
      <RealRestaurantMenu result={extraction} reviewSources={() => go('restaurant')} preview/>
      <section className="guided-demo-menu-actions"><Eyebrow>YOUR NEXT CHAPTER</Eyebrow><h2>Find My Personal Picks</h2>
        <p>See how Meta Muse Spark connects a palate and menu. These replayed Picks are validated fixture results for the sample palate and a {sampleTarget / 100} USD per-dish target, not fresh inference.</p>
        <label>Sample per-dish target <strong>${(app.constraints.max_price_minor / 100).toFixed(2)}</strong><input type="range" min="1000" max="5000" step="100" value={app.constraints.max_price_minor}
          onChange={event => app.setConstraints({ ...app.constraints, max_price_minor: Number(event.target.value) })}/></label>
        <details className="guided-demo-filters"><summary>Dietary and allergy filters</summary>
          <DietaryControls realMenu value={app.constraints.dietary_restrictions} onChange={dietary_restrictions => app.setConstraints({ ...app.constraints, dietary_restrictions })}/>
          <AllergyControls extracted value={app.constraints.allergies} onChange={allergies => app.setConstraints({ ...app.constraints, allergies })}/></details>
        {hasStrict && <p role="status">Strict dietary or allergy choices remain active. This fixture cannot verify their safety, so sample Picks are unavailable under those choices.</p>}
        {!sampleReady && <button type="button" className="button button-outline" onClick={useSample}>Load sample palate and its $22 settings</button>}
        <button type="button" className="button button-primary" disabled={!sampleReady} onClick={() => go('kitchen')}>Find My Personal Picks <Icon name="arrow" size={17}/></button>
        {!sampleReady && <p role="status">Use the sample palate and its original budget to view these precomputed Picks. Your real account is unaffected.</p>}
      </section></main>}
    {stage === 'kitchen' && <KitchenReplay onDone={() => go('picks')} onBack={() => go('menu')}/>}
    {stage === 'picks' && <PicksPreview guided onReplay={() => go('kitchen')} onMenu={() => go('menu')} onMemory={() => go('memory')}
      previewHistory={history} onPreviewChange={record} refinementValue={refinements} onRefinementChange={setRefinements}/>}
    {stage === 'memory' && <main className="content-width page-padding guided-demo-memory"><Eyebrow>YOUR SAMPLE TASTE MEMORY</Eyebrow><h1>The little things <em>you remember.</em></h1>
      <p>These demonstration actions are kept only in this browser tab. Nothing is saved to Supabase or your real guest history.</p>
      {Object.keys(history).length ? <div className="guided-demo-memory-list">{Object.entries(history).map(([id, value]) => {
        const dish = allPicks.find(pick => pick.dish.id === id)?.dish;
        if (!dish) return null;
        return <article key={id}><h2>{dish.name}</h2><p>{value.events.filter(event => event !== 'Rated dish').join(' · ') || 'Tasting note in progress'}{value.events.includes('Rated dish') ? ` · Rated ${value.rating}/5` : ''}</p>
          <label>Correct your note<textarea value={value.note} maxLength={300} onChange={event => record(id, { ...value, note: event.target.value })}/></label>
          <button type="button" className="text-button" onClick={() => setHistory(previous => { const next = { ...previous }; delete next[id]; return next; })}>Delete this demo record</button></article>;
      })}</div> : <div className="guided-demo-memory-empty"><h2>Your sample journal is ready.</h2><p>Choose or save a dish, mark one tried and add a rating in My Picks. It will appear here without affecting your guest history.</p></div>}
      <div className="guided-demo-actions"><button type="button" className="button button-primary" onClick={() => go('picks')}>Return to My Picks</button><button type="button" className="button button-outline" onClick={restart}>Start the demo again</button></div></main>}
  </div>;
}
