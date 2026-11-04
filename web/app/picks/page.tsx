'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDineTuned } from '../../components/AppProvider';
import { ProfileGate } from '../../components/ProfileGate';
import { ErrorState } from '../../components/AsyncState';
import { ButtonLink, Icon } from '../../components/UI';
import { RecommendationCard } from '../../components/recommendations/RecommendationCard';
import { CompleteMyTable } from '../../components/recommendations/CompleteMyTable';
import { WorthTheStretch } from '../../components/recommendations/WorthTheStretch';
import { MakeItMoreMe } from '../../components/recommendations/MakeItMoreMe';
import { BudgetControl, ContextControls, ProteinPreference } from '../../components/menu/PreferenceControls';
import { useApi } from '../../lib/use-api';
import type { RecommendationRequest, RecommendationSession, RestaurantMenu } from '../../lib/contracts';
import { bridgeFeedback, recommendationEvidence, sessionMatchesRequest } from '../../lib/recommendations';
import { axisLabels, axisNames, money } from '../../lib/preferences';
import { restaurantHint } from '../../lib/restaurants/search';
import { useIdentity } from '../../components/IdentityProvider';
import { RealMenuPicks } from '../../components/menu-retrieval/RealMenuPicks';
import { CulinaryOrbit, ORBIT_HANDOFF_MS, type OrbitScene } from '../../components/menu-retrieval/MuseLoading';

const kitchenKey = 'dinetuned-demo-kitchen-pending';
const DEMO_ORBIT_MS = 11000;
function DemoKitchen({ menu, taste, ready, onDone, onBack }: { menu: RestaurantMenu; taste: ReturnType<typeof useDineTuned>['taste']; ready: boolean; onDone: () => void; onBack: () => void }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettled(true), DEMO_ORBIT_MS); return () => clearTimeout(timer); }, []);
  const finishing = settled && ready;
  useEffect(() => { if (!finishing) return; const timer = setTimeout(onDone, ORBIT_HANDOFF_MS); return () => clearTimeout(timer); }, [finishing, onDone]);
  const scene: OrbitScene = { restaurant: menu.restaurant.name, dishCount: menu.total_items, mode: 'mock', preview: true,
    tasteNotes: axisNames.filter(axis => (taste.axes[axis] ?? 0) >= .65).slice(0, 3).map(axis => axisLabels[axis]),
    dishes: menu.categories.flatMap(category => category.items.map(item => ({ name: item.name, category: category.name,
      note: item.description, price: money(item.price.amount_minor) }))).slice(0, 8) };
  return <CulinaryOrbit scene={scene} ready={finishing} onLeave={onBack} onSkip={onDone}/>;
}

function CurrentTablePicks() {
  const { state: identity, retry } = useIdentity();
  if (identity.status === 'connecting' || identity.status === 'ready' && identity.tableLoading) return <main className="content-width page-padding">
    <div className="empty-wide" role="status"><h1>Returning to your table.</h1><p>Restoring your selected restaurant, menu and Picks. No new model request is being made.</p></div></main>;
  if (identity.status === 'error') return <main className="content-width page-padding"><div className="empty-wide" role="alert">
    <Icon name="shield" size={32}/><h1>Your guest table needs a connection.</h1><p>{identity.message} Your saved Taste DNA remains in this browser.</p>
    <button type="button" className="button button-primary" onClick={retry}>Reconnect guest session</button>
    <ButtonLink href="/discover" variant="outline">Explore restaurants</ButtonLink>
  </div></main>;
  const table = identity.status === 'ready' ? identity.table : null;
  const handoff = table?.getSelection();
  if (handoff) {
    const extraction = table?.getExtractionForView(handoff);
    return <main className="real-picks-shell content-width page-padding">
      {extraction ? <RealMenuPicks extraction={extraction} placement="page"/> :
        <div className="empty-wide"><Icon name="book" size={32}/><h1>The menu comes first.</h1>
          <p>Your selected restaurant is {handoff.restaurant.display_name}. Open its menu before asking for personal picks.</p>
          <ButtonLink href="/discover">Return to the restaurant <Icon name="arrow" size={17}/></ButtonLink></div>}
    </main>;
  }
  return <>{identity.status === 'ready' && identity.tableWarning && <p className="content-width source-notice" role="alert">{identity.tableWarning}</p>}<PicksView/></>;
}

function PicksView() {
  const { taste, selection, constraints, setConstraints, detective, tasteEdits, recommendationOptions, setRecommendationOptions, feedback, refinements, setRefinements } = useDineTuned();
  const [tuning, setTuning] = useState(false);
  const [kitchen, setKitchen] = useState(() => typeof window !== 'undefined' && sessionStorage.getItem(kitchenKey) === '1');
  // New feedback informs the next visit; saving a rating must not regenerate this
  // session and erase its saved-feedback state or the user's unfinished notes.
  const [bridgeHistory] = useState(() => bridgeFeedback(feedback));
  const request: RecommendationRequest | undefined = selection ? { ...selection, constraints, profile: taste,
    taste_evidence: recommendationEvidence(detective, tasteEdits.axes), options: recommendationOptions, bridge_feedback: bridgeHistory, refinements } : undefined;
  const result = useApi<RecommendationSession>(selection ? 'recommendation-sessions' : null, 'RecommendationSession', request);
  const kitchenMenu = useApi<RestaurantMenu>(kitchen && selection ? `restaurants/${selection.restaurant_id}/menu` : null, 'RestaurantMenu');
  const closeKitchen = () => { sessionStorage.removeItem(kitchenKey); setKitchen(false); };
  const mismatch = !!result.data && !!request && !sessionMatchesRequest(result.data, request);
  const session = mismatch ? null : result.data;
  const error = result.error || (mismatch ? new Error('These picks do not match your current restaurant and preferences. Please retry.') : null);
  if (!selection) return <main className="content-width page-padding"><div className="empty-wide"><Icon name="book" size={32}/><h1>The menu comes first.</h1>
    <p>Choose a restaurant, explore its complete menu, and set your preferences. Your personal picks start there.</p><ButtonLink href="/discover">Find a restaurant <Icon name="arrow" size={17}/></ButtonLink></div></main>;
  if (kitchen) return kitchenMenu.data ? <DemoKitchen menu={kitchenMenu.data} taste={taste} ready={!!result.data || !!result.error}
    onDone={closeKitchen} onBack={() => { closeKitchen(); window.location.assign('/restaurant/' + selection.restaurant_id); }}/>
    : kitchenMenu.error ? <main className="content-width page-padding"><div className="empty-wide"><h1>The menu needs a moment.</h1><p>{kitchenMenu.error.message}</p><button className="button button-outline" onClick={closeKitchen}>Return to Picks</button></div></main>
      : <main className="content-width page-padding" role="status">Preparing Muse’s Test Kitchen with this fictional menu…</main>;
  const menuHref = '/restaurant/' + selection.restaurant_id;
  const venue = session?.restaurant || restaurantHint(selection.restaurant_id);
  const known = axisNames.filter(axis => taste.axes[axis] !== null).length;
  const count = session?.recommendations.length || 0;
  const emptyTitles = {
    hard_exclusions: 'A little care before a recommendation.',
    insufficient_evidence: 'A few more clues. A better pick.',
    no_strong_matches: 'Nothing quite earns a place yet.',
    over_budget_hidden: 'Your closest matches sit above the target.',
    no_alternatives: 'Every good possibility has had its turn.',
  };
  return <main className="signature-picks content-width page-padding">
    <div className="pp-topline"><Link className="back-link" href={menuHref}><Icon name="left" size={15}/> Back to the complete menu</Link><span>YOUR PERSONAL SELECTION · DEMO</span></div>
    <header className="pp-hero"><div className="pp-hero-copy"><span className="pp-eyebrow">A LITTLE DISCERNMENT. A LOT OF YOU.</span>
      <h1>Not just a dish.<br/><em>Your kind of delicious.</em></h1>
      <p>A considered selection from the whole menu, guided by the flavors and textures you come back for.</p>
      <div className="pp-venue"><Icon name="location" size={18}/><div><strong>{venue?.name || 'Your selected restaurant'}</strong><span>{venue ? `${venue.area} · ${venue.cuisine}` : 'Preparing your selection'}</span></div></div></div>
      <aside className="pp-dna-note"><div className="pp-dna-motif" aria-hidden="true"><i/><i/><i/><Icon name="fork" size={28}/></div><span className="pp-eyebrow">THE THREAD THROUGH IT ALL</span><h2>Your taste,<br/><em>in good company.</em></h2>
        <p>{known ? `${known} sensory dimensions saved in your Taste DNA.` : 'Your open taste questions stay open.'}</p><Link href="/taste">Revisit your Taste DNA <Icon name="arrow" size={14}/></Link></aside></header>
    <section className="pp-budget-bar" aria-label="Recommendation budget options"><div><span className="pp-eyebrow">YOUR PER-DISH TARGET</span><strong>{money(constraints.max_price_minor)}<small>before tax & tip</small></strong></div>
      <p>Strong matches within budget come first. Exceptional alternatives may sit above it; every difference is labeled.</p>
      <label className="pp-budget-toggle"><input type="checkbox" checked={!recommendationOptions.include_over_budget}
        onChange={event => setRecommendationOptions({ ...recommendationOptions, include_over_budget: !event.target.checked })}/><span>Hide above-budget alternatives</span></label></section>
    <MakeItMoreMe value={refinements} session={session} loading={result.loading} tuning={tuning} error={!!error} onChange={value => { setTuning(true); setRefinements(value); }}/>
    <div className="pp-selection-heading"><div><span className="pp-eyebrow">CHOSEN FROM THE COMPLETE MENU</span><h2>{result.loading ? 'A little thought, for your table.' : count === 1 ? 'One dish. Worth a closer look.' : count === 2 ? 'Two ways to make it yours.' : count === 3 ? 'Three considered possibilities.' : 'Only picks with a reason.'}</h2></div>
      <span className="pp-edition">THE DINETUNED EDIT <b>{String(count).padStart(2, '0')}</b></span></div>
    {result.loading ? <div className="pp-loading" aria-busy="true"><div className="mr-loading-flourish" aria-hidden="true"><Icon name="fork" size={25}/><span/></div><h3>{tuning ? 'Tuning Your Table' : 'Finding the connections.'}</h3><p>Comparing your saved taste with this demo menu. No live AI is running.</p></div>
      : error ? <ErrorState error={error} retry={result.retry} back={menuHref}/>
        : session && <><p className="pp-session-note" role="status">{session.message}</p>
          {count > 0 ? <div className="signature-collection" data-count={count}>{session.recommendations.map((rec, index) =>
            <RecommendationCard key={session.id + rec.dish.id} recommendation={rec} session={session} index={index}/>)}</div>
            : <section className="pp-empty"><Icon name={session.empty_reason === 'hard_exclusions' ? 'shield' : 'compass'} size={32}/><h2>{emptyTitles[session.empty_reason || 'no_strong_matches']}</h2>
              <p>{session.empty_reason === 'hard_exclusions' ? 'Uncertain ingredients and allergy information stay excluded. Browse the menu and confirm requirements directly with the restaurant.'
                : session.empty_reason === 'no_alternatives' ? 'No other strong dishes remain for these preferences. Bring back earlier picks or reset refinements above to reconsider the original selection.'
                : session.empty_reason === 'over_budget_hidden' ? 'Your safety restrictions have not changed. You can reveal the labeled alternatives, or keep exploring the complete menu.'
                  : 'A short selection is intentional. Add or revisit your taste preferences, or explore another menu; we do not invent a personal fit.'}</p>
              <div>{session.empty_reason === 'over_budget_hidden' && <button className="button button-primary" onClick={() => setRecommendationOptions({ ...recommendationOptions, include_over_budget: true })}>Show above-budget alternatives <Icon name="arrow" size={16}/></button>}
                <ButtonLink href={menuHref} variant="outline">Review the complete menu <Icon name="arrow" size={16}/></ButtonLink>
                {session.empty_reason !== 'hard_exclusions' && <Link className="text-arrow" href="/taste">Revisit my Taste DNA <Icon name="arrow" size={14}/></Link>}</div></section>}
          <CompleteMyTable key={session.id} session={session}/>
          <WorthTheStretch key={'stretch-' + session.id} session={session}/>
        </>}
    <details className="pp-current-preferences"><summary><Icon name="adjust" size={18}/><div><strong>Your current meal preferences</strong><span>Budget, mood, appetite & protein · changes update this selection</span></div><Icon name="plus" size={18}/></summary>
      <div className="pp-preferences-body"><BudgetControl value={constraints.max_price_minor} onChange={max_price_minor => setConstraints({ ...constraints, max_price_minor })}/>
        <ContextControls value={constraints} onChange={setConstraints}/><ProteinPreference/>
        <Link className="text-arrow" href={menuHref}>Manage dietary restrictions and allergies on the menu <Icon name="arrow" size={14}/></Link></div></details>
    <footer className="pp-honesty"><Icon name="book" size={20}/><div><strong>A thoughtful demo, with honest limits.</strong><p>Fictional menus, labeled illustrations, and deterministic comparisons. Compatibility labels describe evidence, not probabilities. Unknown details stay unknown. Confirm ingredients and preparation with restaurant staff.</p></div><span>FINE-TUNED TO YOUR TASTE.</span></footer>
  </main>;
}
export default function Picks() { return <ProfileGate><CurrentTablePicks/></ProfileGate>; }
