'use client';
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { MealCombination, MealComponent, PairingFact, RecommendationSession, RestaurantMenu } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { tableFallback, tableMedia, tableMenuMatches, tablePortion, tablePresentation } from '../../lib/meal-combinations';
import { useApi } from '../../lib/use-api';
import { DishArt } from '../DishArt';
import { Icon } from '../UI';

const sourceNames: Record<PairingFact['source'], string> = { menu_fixture: 'Demo menu', taste_dna: 'Taste DNA', taste_detective: 'Taste Detective', session: 'This meal’s preferences' };

function TableScene({ combination, session, menu }: { combination: MealCombination; session: RecommendationSession; menu: RestaurantMenu | null }) {
  return <figure className="ct-scene"><div className="ct-place-setting" aria-hidden="true">
    {[combination.main, ...combination.additions].map((part, index) => {
      const media = tableMedia(part, session, menu);
      return <div className={'ct-plate ' + (index ? 'ct-plate-addition' : 'ct-plate-main')} key={part.item_id}>
        {media ? <DishArt name={part.name} media={media} seed={part.item_id} caption={false}/>
          : <div className="ct-unillustrated"><Icon name="fork" size={26}/><span>Illustration unavailable</span></div>}
        <span className="ct-plate-number">{String(index + 1).padStart(2, '0')}</span>
      </div>;
    })}
  </div><figcaption>Menu illustrations · not restaurant photography</figcaption></figure>;
}

function TableDish({ part, combination, index }: { part: MealComponent; combination: MealCombination; index: number }) {
  const portion = tablePortion(combination, part.item_id);
  const portionLabel = portion === 'light' ? (index ? 'Light accompaniment' : 'Light portion') : portion === 'hearty' ? (index ? 'Substantial additional dish' : 'Hearty portion') : 'Portion not specified';
  return <li className="ct-dish" data-table-item={part.item_id}>
    <span className="ct-dish-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    <div className="ct-dish-copy"><span className="ct-kicker">{index ? 'ALONGSIDE' : 'YOUR MAIN'} · {part.category_name}</span>
      <h4>{part.name}</h4><p className="ct-portion">{portionLabel}</p>
      {part.budget.status === 'above_target' && <p className="ct-overage">{money(part.budget.overage_minor)} above your {money(part.budget.target_minor)} per-dish target</p>}
    </div><span className="ct-item-price" aria-label={`${part.name}: ${money(part.price_minor)}`}>{money(part.price_minor)}</span>
  </li>;
}

function TableStory({ combination }: { combination: MealCombination }) {
  const personal = combination.claims.find(claim => combination.evidence.find(fact => fact.id === claim.left_fact_id)?.item_id === null);
  const connection = combination.claims.find(claim => combination.evidence.find(fact => fact.id === claim.left_fact_id)?.item_id !== null);
  return <div className="ct-story"><span className="ct-kicker"><Icon name="spark" size={14}/> THE THREAD THROUGH YOUR TABLE</span>
    <p className="ct-connection">{connection?.text || combination.rationale}</p>
    {personal && <p className="ct-personal"><Icon name="heart" size={14}/><span>{personal.text}</span></p>}
    <details className="ct-details"><summary><span>Why this pairing<small>Sources & room for the unknown</small></span><Icon name="plus" size={18}/></summary>
      <div className="ct-details-body"><p>{combination.rationale}</p>
        <h5>What the evidence supports</h5><ul>{combination.claims.map((claim, i) => <li key={i}>{claim.text}</li>)}</ul>
        <h5>A little perspective</h5><ul>{combination.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul>
        <h5>Behind the pairing</h5><ul className="ct-evidence">{combination.evidence.map(fact => <li key={fact.id}><strong>{sourceNames[fact.source]}</strong>
          <span>{fact.item_id ? [combination.main, ...combination.additions].find(part => part.item_id === fact.item_id)?.name : 'Your preferences'} · {fact.label}{fact.basis === 'inferred' ? ' · inferred from your answers' : ''}</span>
        </li>)}</ul>
      </div>
    </details>
  </div>;
}

/** An optional enrichment chapter; primary Picks and feedback remain independent. */
export function CompleteMyTable({ session }: { session: RecommendationSession }) {
  const id = useId();
  const presentation = tablePresentation(session);
  const menu = useApi<RestaurantMenu>(presentation.combinations.length ? `restaurants/${session.restaurant.id}/menu` : null, 'RestaurantMenu');
  const changedMenu = !!menu.data && !tableMenuMatches(session, menu.data);
  const combinations = changedMenu ? [] : presentation.combinations;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = Math.max(0, combinations.findIndex(combination => combination.id === selectedId));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % combinations.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + combinations.length) % combinations.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = combinations.length - 1;
    else return;
    event.preventDefault(); setSelectedId(combinations[next].id); tabs.current[next]?.focus();
  }
  return <section className="complete-table" aria-labelledby={`${id}-heading`} data-table-count={combinations.length}>
    <header className="ct-heading"><div><span className="ct-kicker">A LITTLE MORE TO LOVE · {session.meal_combinations?.mode === 'model' ? 'MENU PAIRINGS' : 'DEMO PAIRINGS'}</span>
      <h2 id={`${id}-heading`}>Complete My Table</h2><p>The little things that make a meal.</p></div>
      <div className="ct-setting-mark" aria-hidden="true"><i/><i/><Icon name="fork" size={24}/></div>
    </header>
    {combinations.length ? <>
      <div className="ct-introduction"><p>Build around a personal pick at <strong>{session.restaurant.name}</strong>. Each table is a separate meal idea.</p>
        <span>Your <strong>{money(session.constraints.max_price_minor)}</strong> target is <strong>per dish</strong>, not per meal.</span></div>
      <div className="ct-options" role="tablist" aria-label="Choose a meal combination">{combinations.map((combination, index) =>
        <button key={combination.id} role="tab" ref={node => { tabs.current[index] = node; }} id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
          tabIndex={active === index ? 0 : -1} onClick={() => setSelectedId(combination.id)} onKeyDown={event => navigate(event, index)}>
          <span className="ct-option-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span><small>AROUND YOUR</small><strong>{combination.main.name}</strong></span>
          <span className="ct-option-total">{money(combination.subtotal_minor)}<small>meal subtotal</small></span>
        </button>)}</div>
      {combinations.map((combination, index) => <div className="ct-table-panel" key={combination.id} id={`${id}-panel-${index}`} role="tabpanel"
        aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={active !== index} data-combination-id={combination.id}>
        <TableScene combination={combination} session={session} menu={menu.data}/>
        <div className="ct-table-copy"><div className="ct-table-title"><span className="ct-kicker">TABLE {String(index + 1).padStart(2, '0')} · THE COMPLETE PICTURE</span><h3>Around {combination.main.name}</h3></div>
          <ol className="ct-dishes">{[combination.main, ...combination.additions].map((part, partIndex) => <TableDish key={part.item_id} part={part} combination={combination} index={partIndex}/>)}</ol>
          <div className="ct-subtotal"><div><span>Meal subtotal</span><small>Tax, tip & other fees excluded</small></div><strong>{money(combination.subtotal_minor)}</strong></div>
          <TableStory combination={combination}/>
        </div>
      </div>)}
      <footer className="ct-footnote"><span><Icon name="info" size={15}/>{presentation.limited ? 'A smaller selection, with enough evidence to share.' : 'A considered pairing, not a promise of perfect harmony.'}</span>
        <Link href={`/restaurant/${session.restaurant.id}/`}>Revisit the complete menu <Icon name="arrow" size={15}/></Link></footer>
    </> : <div className="ct-empty"><span className="ct-empty-mark" aria-hidden="true"><Icon name="fork" size={24}/></span><div><h3>A little room at your table.</h3>
      <p>{tableFallback(changedMenu ? 'menu_changed' : presentation.fallback)}</p><Link href={`/restaurant/${session.restaurant.id}`}>Explore the complete menu <Icon name="arrow" size={15}/></Link></div></div>}
  </section>;
}
