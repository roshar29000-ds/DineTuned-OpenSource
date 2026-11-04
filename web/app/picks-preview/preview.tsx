'use client';
import Link from 'next/link';
import { useState } from 'react';
import fixture from '../../tests/fixtures/picks-preview.json';
import type { MenuExtractionResult, RealPicksResult, RefinementRequest } from '../../lib/contracts';
import { emptyRefinements, refinementChoices, supportedRefinement, toggleRefinement } from '../../lib/refinements';
import { money } from '../../lib/preferences';
import { Eyebrow } from '../../components/UI';
import { RealPicksSections } from '../../components/menu-retrieval/RealMenuPicks';
import type { PreviewExperienceState } from '../../components/menu-retrieval/PreviewDishExperience';

const extraction = fixture.extraction as MenuExtractionResult;
const result = fixture.result as RealPicksResult;

export function PicksPreview({ guided = false, onReplay, onMenu, onMemory, previewHistory, onPreviewChange, refinementValue, onRefinementChange }: {
  guided?: boolean; onReplay?: () => void; onMenu?: () => void; onMemory?: () => void;
  previewHistory?: Record<string, PreviewExperienceState>; onPreviewChange?: (dishId: string, value: PreviewExperienceState) => void;
  refinementValue?: RefinementRequest; onRefinementChange?: (value: RefinementRequest) => void;
} = {}) {
  const [localRefinements, setLocalRefinements] = useState(emptyRefinements());
  const refinements = refinementValue || localRefinements;
  const setRefinements = (value: RefinementRequest | ((previous: RefinementRequest) => RefinementRequest)) => {
    const next = typeof value === 'function' ? value(refinements) : value;
    if (onRefinementChange) onRefinementChange(next); else setLocalRefinements(next);
  };
  const [message, setMessage] = useState('');
  const [phrase, setPhrase] = useState('');
  const restaurant = extraction.menu.restaurant;
  const target = result.recommendations[0]?.budget.target_minor ?? 2200;
  return <main className="real-picks-shell content-width page-padding"><section id="reveal" className="real-picks real-picks-page" aria-label="Offline Personalized Picks preview">
    <div className="real-picks-topline">{guided ? <button type="button" className="text-button" onClick={onReplay}>Replay Muse’s Test Kitchen</button>
      : <Link href="/culinary-orbit-preview">Replay Muse’s Culinary Orbit</Link>}<span>OFFLINE DESIGN PREVIEW</span></div>
    <div className="real-picks-intro"><div><Eyebrow>YOUR PERSONALIZED PICKS FOR</Eyebrow><h2>Your personal <em>selection.</em></h2>
      <p>A fictional menu, presented without provider calls or guest data.</p></div>
      <div className="real-picks-venue"><span>AT YOUR DEMO TABLE</span><strong>{restaurant.display_name}</strong><small>{restaurant.formatted_address} · fictional fixture</small></div></div>
    <div className="picks-preview-notice" role="status"><strong>Offline demonstration of a Meta Muse-powered journey.</strong>
      {' '}These are prepared fixture Picks and local illustrations of fictional dishes; no Muse Spark or Muse Image call, and no guest data changes.</div>
    <p>Sample per-dish target: <strong>{money(target)}</strong> · dietary suitability unverified.</p>
    <RealPicksSections result={result} restaurantName={restaurant.display_name} target={target} preview
      previewHistory={previewHistory} onPreviewChange={onPreviewChange}/>
    <section className="real-refinements" aria-label="Make It More Me preview"><Eyebrow>A LITTLE CLOSER TO YOU</Eyebrow><h3>Make It More Me</h3>
      <p>Explore the one-tap controls here. The sample ranking remains fixed; no model request or guest update occurs.</p>
      <div className="real-refinement-choices">{refinementChoices.map(choice => <button key={choice.id} type="button"
        aria-pressed={refinements.preferences.includes(choice.id)} onClick={() => { setRefinements(toggleRefinement(refinements, choice.id)); setMessage(`${choice.label} selected in this offline preview. The sample Picks stay fixed.`); }}>{choice.label}</button>)}</div>
      <label className="real-refinement-phrase">Tell us the direction <span>Supported phrases: “less creamy,” “something lighter,” “more spicy,” or “more adventurous.”</span>
        <input value={phrase} onChange={event => setPhrase(event.target.value)} placeholder="For example, something lighter" maxLength={160}/></label>
      <div className="real-refinement-actions"><button type="button" className="text-button" onClick={() => setMessage('This fixture has no alternate ranked dishes. Your real table was not changed.')}>Try another dish</button>
        <button type="button" className="text-button" onClick={() => { setRefinements(emptyRefinements()); setMessage('Preview refinements reset.'); }}>Reset refinements</button></div>
      <button type="button" className="button button-primary real-refinement-submit" onClick={() => {
        const mapped = phrase.trim() ? supportedRefinement(phrase) : null;
        if (phrase.trim() && !mapped) { setMessage('Try a supported direction. No model request was sent.'); return; }
        if (mapped && !refinements.preferences.includes(mapped)) setRefinements(value => ({ ...value, preferences: [...value.preferences, mapped] }));
        setPhrase(''); setMessage('Offline preview only. The sample Picks stay fixed and no model request was sent.');
      }}>Update My Picks</button>
      <p className="real-refinement-assurance">Your real Taste DNA and dining history remain untouched in this offline preview.</p>
      {message && <p role="status">{message}</p>}
    </section>
    {guided && <div className="guided-demo-next"><button type="button" className="button button-outline" onClick={onMenu}>Back to complete menu</button>
      <button type="button" className="button button-primary" onClick={onMemory}>See Taste Memory <span aria-hidden="true">→</span></button></div>}
  </section></main>;
}
