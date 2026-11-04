'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { MenuExtractionResult, RealPicksCapability, RealPicksRequest, RealPicksResult,
  RealPersonalizedPick, RealTasteBridge, RealMealCombination } from '../../lib/contracts';
import { realPersonalizedPicks, realPicksCapability } from '../../lib/real-picks';
import { emptyRefinements, refinementChoices, supportedRefinement, toggleRefinement } from '../../lib/refinements';
import { recommendationEvidence } from '../../lib/recommendations';
import { sourcePage } from '../../lib/menu-retrieval/extracted-presentation';
import { money } from '../../lib/preferences';
import { useDineTuned } from '../AppProvider';
import { useIdentity } from '../IdentityProvider';
import { BudgetControl, DietaryControls, AllergyControls } from '../menu/PreferenceControls';
import { Eyebrow, Icon } from '../UI';
import { RealDishExperience } from './RealDishExperience';
import { signedTokenExpired } from '../../lib/menu-retrieval/real-session';
import { RealPickImage } from './RealPickImage';
import { MuseLoading, ORBIT_HANDOFF_MS } from './MuseLoading';
import { PreviewDishArt } from './PreviewDishArt';
import { PreviewDishExperience, type PreviewExperienceState } from './PreviewDishExperience';

function EvidenceLink({ url, page, label, preview = false }: { url: string; page: number | null; label: string; preview?: boolean }) {
  if (preview) return <span>{label} · fictional fixture evidence</span>;
  if (url.startsWith('urn:dinetuned:upload:')) return <span>{label} · uploaded document{page ? ` · page ${page}` : ''}</span>;
  return <a href={sourcePage(url, page)} target="_blank" rel="noopener noreferrer">{label}{page ? ` · page ${page}` : ''}</a>;
}

function conciseReason(reason: string) {
  const first = reason.trim().split(/(?<=[.!?])\s+/)[0] || reason;
  const words = first.split(/\s+/);
  return words.length > 35 ? words.slice(0, 35).join(' ') + '…' : first;
}

function briefWords(value: string) {
  const words = value.trim().split(/\s+/);
  return words.length > 35 ? words.slice(0, 35).join(' ') + '…' : value.trim();
}

function editorialHook(pick: RealPersonalizedPick) {
  const description = pick.dish.description?.trim();
  const firstLink = pick.connections[0];
  const groundedLead = description && firstLink ? briefWords(`${conciseReason(description)} ${firstLink.preference.basis === 'inferred'
    ? `If ${familiarLabel(firstLink.preference.label)} appeals to you, this could be worth exploring.`
    : `A promising fit for your taste for ${familiarLabel(firstLink.preference.label)}.`}`) : null;
  const natural = pick.explanation.trim().split(/(?<=[.!?])\s+/)
    .find(sentence => !/^(you told us|your taste dna|based on your)/i.test(sentence) && !/caught our eye because/i.test(sentence));
  if (groundedLead && (!natural || natural.trim() === description || natural.trim() === conciseReason(description || ''))) return groundedLead;
  if (natural) return conciseReason(natural);
  if (groundedLead) return groundedLead;
  if (description) return conciseReason(description);
  const link = pick.connections[0];
  if (!link) return conciseReason(pick.explanation);
  const quote = link.menu_quote.trim().replace(/[.\s]+$/, '');
  const short = quote.length > 115 ? quote.slice(0, 112).replace(/\s+\S*$/, '') + '…' : quote;
  const label = link.preference.label.replace(/^(high|moderate|low) /, '').replace(/ preference$/, '');
  const anchor = link.preference.source === 'taste_memory' ? 'a taste you noted after dining' : `your taste for ${label}`;
  return `“${short}” — a menu detail connected to ${anchor}.`;
}

function familiarLabel(label: string) {
  return label.split(/[;,]/)[0].trim().replace(/^(high|moderate|low) /i, '').replace(/ preference$/i, '');
}

function bridgeDetail(bridge: RealTasteBridge) {
  if (!/you told us|your taste dna|the thread to|caught our eye/i.test(bridge.connection)) return bridge.connection;
  const interest = bridge.anchor.basis === 'inferred' ? 'a possible interest in' : 'your taste for';
  return `The menu describes this dish as “${bridge.menu_quote}”. That may connect with ${interest} ${familiarLabel(bridge.anchor.label)}.`;
}

export function PickCard({ pick, index, bridge, result, restaurantName, stretch = false, readOnly = false, preview = false, previewState, onPreviewChange }: { pick: RealPersonalizedPick; index: number;
  bridge?: RealTasteBridge; result: RealPicksResult; restaurantName: string; stretch?: boolean; readOnly?: boolean; preview?: boolean;
  previewState?: PreviewExperienceState; onPreviewChange?: (dishId: string, value: PreviewExperienceState) => void }) {
  const detail = <div className="real-pick-detail-content">
    {bridge && <section className="real-pick-detail-bridge"><h4>Your taste connection</h4><p>{bridgeDetail(bridge)}</p><p>{bridge.uncertainty}</p>
      <EvidenceLink url={bridge.evidence.source_url} page={bridge.evidence.page} label="Source for this connection" preview={preview}/></section>}
    <details className="real-item-notes"><summary>Menu evidence &amp; limits</summary>
      {pick.connections.map((connection, i) => <div key={i}><p>{connection.preference.basis} · {connection.preference.label}</p><blockquote>{connection.menu_quote}</blockquote>
        <EvidenceLink url={connection.evidence.source_url} page={connection.evidence.page} label="View menu evidence" preview={preview}/></div>)}
      <ul>{pick.limitations.map(line => <li key={line}>{line}</li>)}</ul></details></div>;
  return <article className={'real-menu-item real-pick' + (stretch ? ' real-pick-stretch' : index === 0 ? ' real-pick-featured' : '')} data-real-pick={pick.dish.id}>
    {preview ? <PreviewDishArt dishName={pick.dish.name}/> : stretch ? <figure className="real-pick-media real-pick-stretch-media"><div className="real-pick-media-placeholder" aria-hidden="true"><b>{pick.dish.name}</b></div>
      <figcaption>Menu illustration unavailable · actual presentation unknown</figcaption></figure> :
      <RealPickImage digest={result.context_digest} dishId={pick.dish.id} dishName={pick.dish.name} canCheck={result.mode === 'meta'}/>}
    <div className="real-pick-content">
    <div className="real-pick-ordinal" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
    <span className="section-kicker">{stretch ? 'A WORTHWHILE EXTRA' : `YOUR PICK ${String(index + 1).padStart(2, '0')}`}</span>
    <div className="real-menu-item-top"><h3>{pick.dish.name}</h3><strong>{money(pick.price_minor)}</strong></div>
    <p>{pick.category_name}</p>{pick.budget.overage_minor > 0 && <span className="real-menu-flag">{money(pick.budget.overage_minor)} above your per-dish target</span>}
    <div className="real-pick-reason"><p>{editorialHook(pick)}</p></div>
    {bridge && <div className="real-pick-bridge"><span className="section-kicker">TASTEBRIDGE</span>
      <div className="real-bridge-line"><span><small>{bridge.anchor.basis === 'inferred' ? 'POSSIBLE TASTE' : 'FAMILIAR TASTE'}</small>{familiarLabel(bridge.anchor.label)}</span><i aria-hidden="true">→</i><strong><small>NEW DISCOVERY</small>{pick.dish.name}</strong></div></div>}
    {readOnly ? <details className="real-pick-readonly"><summary>More about this pick</summary>{detail}</details> : preview ?
      <PreviewDishExperience dishName={pick.dish.name} details={detail} value={previewState} onChange={onPreviewChange ? value => onPreviewChange(pick.dish.id, value) : undefined}/> :
      <RealDishExperience result={result} pick={pick} restaurantName={restaurantName} details={detail}/>}
    </div>
  </article>;
}

export function CompleteRealTable({ tables, picks, target, digest, preview = false, readOnly = false }: { tables: RealMealCombination[]; picks: RealPersonalizedPick[];
  target: number; digest: string; preview?: boolean; readOnly?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!tables.length) return null;
  return <section className="real-table" aria-label="Complete My Table"><Eyebrow>A LITTLE MORE TO LOVE</Eyebrow>
    <h3>Complete My Table</h3><p>The little things that make a meal. These are separate meal ideas from the source menu.</p>
    <p>Your {money(target)} target is <strong>per dish</strong>, not a total meal cap.</p>
    <div className="real-table-list">{tables.map((table, index) => {
      const main = picks.find(p => p.dish.id === table.main_item_id);
      if (!main) return null;
      return <article className={'real-table-combination' + (selected === index ? ' is-selected' : '')} key={`${table.main_item_id}-${index}`}>
        <div className="real-table-photo">{preview ? <PreviewDishArt dishName={table.additions[0]?.dish.name || main.dish.name}/> :
          <RealPickImage digest={digest} dishId={main.dish.id} dishName={main.dish.name} canCheck={false}/>}</div><div className="real-table-copy">
        <span className="section-kicker">TABLE {String(index + 1).padStart(2, '0')}</span>
        <h4>Around {main.dish.name}</h4>
        <ol><li><span><strong>{main.dish.name}</strong><small>{main.category_name} · your main</small></span><strong>{money(main.price_minor)}</strong></li>
          {table.additions.map(addition => <li key={addition.dish.id}><span><strong>{addition.dish.name}</strong><small>{addition.category_name} · alongside
            {addition.price_minor > target ? ` · ${money(addition.price_minor - target)} above per-dish target` : ''}</small></span><strong>{money(addition.price_minor)}</strong></li>)}</ol>
        {selected === index && <div className="real-table-total"><span>Selected meal subtotal <small>Tax, tip and fees excluded</small></span><strong>{money(table.subtotal_minor)}</strong></div>}
        <p>{conciseReason(table.rationale)}</p><button type="button" className="real-table-select" aria-pressed={selected === index} disabled={readOnly}
          onClick={() => setSelected(value => value === index ? null : index)}>{selected === index ? 'Remove from my table' : 'Choose this table'}</button>
        {selected === index && <small className="real-table-planning" role="status">Saved for this visit as a meal idea. No order has been placed.</small>}
        <details><summary>Sources &amp; limits</summary><p>{table.rationale}</p><ul>{table.limitations.map(line => <li key={line}>{line}</li>)}</ul>
          {table.additions.map(a => <p key={a.dish.id}><EvidenceLink url={a.evidence.source_url} page={a.evidence.page} label={`Source for ${a.dish.name}`} preview={preview}/></p>)}</details></div>
      </article>;
    })}</div>
  </section>;
}

/** Shared, validated presentation for the live page and the isolated fixture preview. */
export function RealPicksSections({ result, restaurantName, target, readOnly = false, preview = false, previewHistory, onPreviewChange }: {
  result: RealPicksResult; restaurantName: string; target: number; readOnly?: boolean; preview?: boolean;
  previewHistory?: Record<string, PreviewExperienceState>; onPreviewChange?: (dishId: string, value: PreviewExperienceState) => void;
}) {
  return <><div className="real-picks-list">{result.recommendations.map((pick, index) => <PickCard key={pick.dish.id} pick={pick} index={index}
    result={result} restaurantName={restaurantName} readOnly={readOnly} preview={preview}
    previewState={previewHistory?.[pick.dish.id]} onPreviewChange={onPreviewChange}
    bridge={result.taste_bridges?.find(value => value.item_id === pick.dish.id)}/>)}</div>
    <CompleteRealTable tables={result.meal_combinations || []} picks={result.recommendations} target={target}
      digest={result.context_digest} preview={preview} readOnly={readOnly}/>
    {!!result.worth_the_stretch?.length && <section className="real-stretch" aria-label="Worth the Stretch"><Eyebrow>A FINAL CONSIDERATION</Eyebrow>
      <h3>Worth the Stretch</h3><p>Exceptional alternatives beyond your per-dish target, separate from your primary picks and meal subtotal.</p>
      <div className="real-picks-list">{result.worth_the_stretch.map((pick, index) => <PickCard key={pick.dish.id} pick={pick} index={index} stretch
        result={result} restaurantName={restaurantName} readOnly={readOnly} preview={preview}
        previewState={previewHistory?.[pick.dish.id]} onPreviewChange={onPreviewChange}
        bridge={result.taste_bridges?.find(value => value.item_id === pick.dish.id)}/>)}</div></section>}</>;
}

export function RealMenuPicks({ extraction, placement = 'menu' }: { extraction: MenuExtractionResult; placement?: 'menu' | 'page' }) {
  const router = useRouter();
  const app = useDineTuned(), identity = useIdentity().state;
  const table = identity.status === 'ready' ? identity.table : null;
  const [capability, setCapability] = useState<RealPicksCapability | null>(null);
  const [availabilityError, setAvailabilityError] = useState('');
  const [capabilityCheck, setCapabilityCheck] = useState(0);
  const [refinementMessage, setRefinementMessage] = useState('');
  const [refinementText, setRefinementText] = useState('');
  const [pendingApply, setPendingApply] = useState(false);
  const [view, setView] = useState<{ key: string; result?: RealPicksResult; error?: string; loading?: boolean } | null>(null);
  const active = useRef<AbortController | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = { extraction, profile: app.taste, taste_evidence: recommendationEvidence(app.detective, app.tasteEdits.axes),
    constraints: app.constraints, options: app.recommendationOptions, refinements: app.refinements };
  const key = JSON.stringify([input, identity.status === 'ready' ? identity.userId : null]);
  const latest = useRef(key); latest.current = key;
  const sessionValid = !!extraction.recommendation_token && !signedTokenExpired(extraction.recommendation_token);
  const saved = table?.getPicks(key);
  const historical = !saved && identity.status === 'ready' ? table?.getSavedPicksForView(identity.userId) : null;
  const showingEarlier = !!historical && view?.key !== key;
  const current: { key: string; result?: RealPicksResult; error?: string; loading?: boolean } | null =
    view?.key === key ? view : saved ? { key, result: saved } : historical ? { key, result: historical } : null;
  useEffect(() => {
    const controller = new AbortController();
    realPicksCapability(controller.signal).then(setCapability).catch(error => {
      if (!controller.signal.aborted) setAvailabilityError(error instanceof Error ? error.message : 'Personalization is unavailable.');
    });
    return () => controller.abort();
  }, [capabilityCheck]);
  useEffect(() => {
    active.current?.abort(); active.current = null;
    if (revealTimer.current) clearTimeout(revealTimer.current);
    return () => { active.current?.abort(); if (revealTimer.current) clearTimeout(revealTimer.current); };
  }, [key]);
  useEffect(() => { if (!pendingApply) return; setPendingApply(false); void findPicks(); }, [pendingApply, key]);
  async function findPicks() {
    if (!capability?.available || !sessionValid || identity.status !== 'ready' || active.current || current?.result && !showingEarlier || current?.error) return;
    const controller = new AbortController(); active.current = controller;
    setView({ key, loading: true });
    const request: RealPicksRequest = { ...input, request_id: crypto.randomUUID() };
    try {
      const result = await realPersonalizedPicks(request, identity.getAccessToken, controller.signal);
      if (!controller.signal.aborted && latest.current === key) {
        table?.setPicks(key, result);
        if (result.recommendations.length) {
          setView({ key, result, loading: true });
          revealTimer.current = setTimeout(() => {
            revealTimer.current = null;
            if (latest.current !== key) return;
            setView({ key, result });
            if (placement === 'menu') router.push('/picks#reveal');
          }, ORBIT_HANDOFF_MS);
        } else { setView({ key, result }); if (placement === 'menu') router.push('/picks'); }
      }
    } catch (error) {
      if (!controller.signal.aborted && latest.current === key) setView({ key, error: error instanceof Error ? error.message : 'Personalization could not finish. No automatic retry was made.' });
    } finally { if (active.current === controller) active.current = null; }
  }
  function updatePicks() {
    if (!capability?.available || !sessionValid || identity.status !== 'ready' || current?.loading) return;
    const phrase = refinementText.trim();
    if (phrase) {
      const choice = supportedRefinement(phrase);
      if (!choice) { setRefinementMessage('Try one of the supported directions above. No request was sent.'); return; }
      setRefinementText('');
      if (!app.refinements.preferences.includes(choice)) {
        app.setRefinements({ ...app.refinements, preferences: [...app.refinements.preferences, choice] });
        setRefinementMessage('Tuning this table with your selected direction.');
        setPendingApply(true);
        return;
      }
    }
    if (current?.result && !showingEarlier) { setRefinementMessage('These Picks already use the selected directions.'); return; }
    setRefinementMessage('Tuning this table with your selected directions.');
    void findPicks();
  }
  if (!capability?.available && !current?.result) return <aside className="real-menu-safety" aria-label="Personalization availability"><Icon name="book" size={24}/><div>
    <h3>A menu to explore. Picks come after verification.</h3>
    <p>Ingredients, dietary suitability and allergen cross-contact have not been verified. Confirm requirements with restaurant staff.</p>
    <p>{availabilityError || capability?.message || 'Checking personalization availability. No model request is being made.'}</p>
    <p>Source-linked TasteBridge, meal ideas and temporary refinements are available when the parsed menu and an approved provider are ready.</p>
    <button type="button" className="button button-outline" onClick={() => { setAvailabilityError(''); setCapabilityCheck(value => value + 1); }}>
      Recheck Picks availability</button>
  </div></aside>;
  const preferenceControls = <div className="real-picks-controls"><details className="real-menu-verification"><summary>Budget, restrictions &amp; allergies</summary>
    <BudgetControl softTarget value={app.constraints.max_price_minor} sliderStepMinor={100} onChange={max_price_minor => app.setConstraints({ ...app.constraints, max_price_minor })}/>
    <DietaryControls realMenu value={app.constraints.dietary_restrictions} onChange={dietary_restrictions => app.setConstraints({ ...app.constraints, dietary_restrictions })}/>
    <AllergyControls extracted value={app.constraints.allergies} onChange={allergies => app.setConstraints({ ...app.constraints, allergies })}/>
  </details><label className="real-picks-budget"><input type="checkbox" checked={!app.recommendationOptions.include_over_budget}
    onChange={event => app.setRecommendationOptions({ ...app.recommendationOptions, include_over_budget: !event.target.checked })}/> Hide above-budget alternatives</label></div>;
  return <section id={placement === 'page' ? 'reveal' : undefined} className={'real-picks' + (placement === 'page' ? ' real-picks-page' : ' real-picks-menu')} aria-label="Personalized Picks from extracted menu">
    {placement === 'page' && <div className="real-picks-topline"><Link href="/discover" className="back-link"><Icon name="left" size={15}/> Back to the complete menu</Link><span>{current?.result?.mode === 'meta' ? 'CURATED WITH META MUSE SPARK 1.3' : 'YOUR PERSONAL SELECTION'}</span></div>}
    <div className="real-picks-intro"><div><Eyebrow>YOUR PERSONALIZED PICKS FOR</Eyebrow><h2>{placement === 'page' ? <>Your personal <em>selection.</em></> : <>Personalized <em>Picks.</em></>}</h2>
      <p>{placement === 'page' ? `${current?.result?.recommendations.length || 'A few'} considered dishes from ${extraction.menu.restaurant.display_name}, selected for the tastes you shared.` : 'Explore the whole menu, then let your Taste DNA lead the way.'}</p>
      {current?.result?.mode === 'mock' && <p>MOCKED / OFFLINE · Fixture responses, not real Meta inference.</p>}
      {placement === 'page' && <Link href="/how-it-works#what-powers-this" className="real-picks-meta-note">What powers these Picks?</Link>}</div>
      {placement === 'page' && <div className="real-picks-venue"><span>AT YOUR TABLE</span><strong>{extraction.menu.restaurant.display_name}</strong><small>{extraction.menu.restaurant.formatted_address}</small></div>}</div>
    {capability?.message.startsWith('TECHNICAL TEST ONLY') && !current?.result && <p className="source-notice" role="alert">{capability.message}</p>}
    {(placement !== 'page' || !current?.result) && preferenceControls}
    <p className="real-picks-target">Per-dish target: <strong>{money(app.constraints.max_price_minor)}</strong>. Only exceptional alternatives may exceed it.</p>
    {placement === 'page' && current?.result ? null : placement === 'menu' && current?.result ? <Link className="button button-primary" href="/picks">View My Personal Picks <Icon name="arrow" size={18}/></Link> :
      <button className="button button-primary" onClick={() => void findPicks()} disabled={identity.status !== 'ready' || !sessionValid || !!current?.loading || !!current?.result && !showingEarlier || !!current?.error || !capability?.available}>
        {current?.loading ? 'Tuning your table…' : app.refinements.preferences.length || app.refinements.avoid_dish_ids.length ? 'Tune My Table' : 'Find My Personal Picks'}<Icon name="arrow" size={18}/></button>}
    {placement === 'menu' && !current?.result && <p className="real-picks-meta-note">For an approved real-menu request, Meta Muse Spark 1.3 considers your Taste DNA alongside this extracted menu. DineTuned checks the evidence and your restrictions before showing Picks.</p>}
    {!sessionValid && <p role="status">This menu remains browsable. New Picks require a fresh verified menu snapshot{current?.result ? '; your saved selection is still available below' : ''}.</p>}
    {showingEarlier && <p className="source-notice" role="status">Saved selection from an earlier taste, budget or refinement setting. Shown for review only; it has not been checked against your current restrictions. Return to the complete menu before making an ordering decision.</p>}
    {(current?.loading || current?.error) && <MuseLoading menu={extraction} taste={app.taste} mode={capability?.mode || 'disabled'}
      ready={!!current.result?.recommendations.length} error={current.error}
      onLeave={() => { active.current?.abort(); active.current = null; if (revealTimer.current) clearTimeout(revealTimer.current);
        revealTimer.current = null; setView(current?.result ? { key, result: current.result } : null); }}
      onRetry={() => { setView(null); setPendingApply(true); }}
      onBack={() => { setView(null); if (placement === 'page') router.push('/discover'); }}/>}
    {current?.result && placement === 'page' && <><p role={current.result.message.startsWith('TECHNICAL TEST ONLY') ? 'alert' : 'status'}
      className={current.result.message.startsWith('TECHNICAL TEST ONLY') ? 'source-notice' : undefined}>
      {current.result.mode === 'mock' ? 'MOCKED / OFFLINE · ' : ''}{current.result.message}</p>
      <RealPicksSections result={current.result} restaurantName={extraction.menu.restaurant.display_name}
        target={current.result.recommendations[0]?.budget.target_minor ?? app.constraints.max_price_minor} readOnly={showingEarlier || !sessionValid}/>
      {preferenceControls}
      <details className="real-menu-verification"><summary>Selection notes</summary><ul>{current.result.limitations.map(line => <li key={line}>{line}</li>)}</ul>
        <p>{current.result.exclusions.length} menu or model candidates excluded by validation. Missing safety or price evidence is never filled in.</p></details>
    </>}
    {placement === 'page' && <section className="real-refinements" aria-label="Make It More Me"><Eyebrow>A LITTLE CLOSER TO YOU</Eyebrow><h3>Make It More Me</h3>
      <p>Temporary choices for this table. Your saved Taste DNA stays as it is. Suggestions use only supported menu text.</p>
      <div className="real-refinement-choices">{refinementChoices.map(choice => <button key={choice.id} type="button"
        aria-pressed={app.refinements.preferences.includes(choice.id)} disabled={!!current?.loading || !capability?.available || !sessionValid}
        onClick={() => { setRefinementMessage(''); app.setRefinements(toggleRefinement(app.refinements, choice.id)); }}>{choice.label}</button>)}</div>
      <label className="real-refinement-phrase">Tell us the direction <span>Supported phrases: “less creamy,” “something lighter,” “more spicy,” or “more adventurous.”</span>
        <input type="text" value={refinementText} maxLength={160} placeholder="For example, something lighter" disabled={!capability?.available || !sessionValid || !!current?.loading}
          onChange={event => setRefinementText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); updatePicks(); } }}/></label>
      {!!app.refinements.avoid_dish_ids.length && <p>{app.refinements.avoid_dish_ids.length} earlier {app.refinements.avoid_dish_ids.length === 1 ? 'dish' : 'dishes'} set aside for this session.</p>}
      <div className="real-refinement-actions"><button type="button" className="text-button" disabled={!current?.result?.recommendations.length || !!current?.loading || !capability?.available || !sessionValid}
        onClick={() => {
          const next = [...new Set([...app.refinements.avoid_dish_ids, ...(current?.result?.recommendations || []).map(p => p.dish.id)])];
          if (next.length === app.refinements.avoid_dish_ids.length || next.length > 50) { setRefinementMessage('No additional dishes can be set aside. Reset refinements to reconsider earlier picks.'); return; }
          setRefinementMessage('Earlier picks set aside. Select Tune My Table to seek another strong dish.');
          app.setRefinements({ ...app.refinements, avoid_dish_ids: next });
        }}>Try another dish</button>
        <button type="button" className="text-button" disabled={!app.refinements.preferences.length && !app.refinements.avoid_dish_ids.length || !!current?.loading}
          onClick={() => { setRefinementMessage('Refinements reset. Select Find My Personal Picks to return to the original selection.'); app.setRefinements(emptyRefinements()); }}>Reset refinements</button></div>
      <button type="button" className="button button-primary real-refinement-submit" disabled={!capability?.available || !sessionValid || identity.status !== 'ready' || !!current?.loading}
        onClick={updatePicks}>Update My Picks <Icon name="arrow" size={17}/></button>
      <p className="real-refinement-assurance">Your saved dietary restrictions and allergies remain in place. A new request is made only when you choose Update My Picks.</p>
      {refinementMessage && <p role="status">{refinementMessage}</p>}
      {!capability?.available && <p role="status">Your current Picks remain available. Fresh AI retuning is paused; no model request will be sent.</p>}
      {(!!app.refinements.preferences.length || !!app.refinements.avoid_dish_ids.length) && !current?.result && <p role="status">Select Tune My Table to request a fresh selection. No request is sent just by changing a choice.</p>}
    </section>}
  </section>;
}
