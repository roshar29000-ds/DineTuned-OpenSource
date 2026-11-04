'use client';
import { useId } from 'react';
import type { PersonalizedDish, RecommendationSession } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { stretchPicks } from '../../lib/stretch';
import { readableTasteBridge } from '../../lib/tastebridge';
import { DishArt } from '../DishArt';
import { Icon } from '../UI';
import { TasteBridge } from './TasteBridge';

function StretchDish({ pick, index }: { pick: PersonalizedDish; index: number }) {
  const id = useId();
  const bridge = readableTasteBridge(pick.taste_bridge);
  return <article className="stretch-dish" data-stretch-id={pick.dish.id} aria-labelledby={id}>
    <figure className="stretch-portrait"><div className="stretch-plate"><DishArt name={pick.dish.name} media={pick.dish.media} seed={pick.dish.id} caption={false}/></div>
      <span className="stretch-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <figcaption>Illustration · not restaurant photography</figcaption></figure>
    <div className="stretch-story"><div className="stretch-heading"><div><span className="stretch-kicker">ANOTHER POSSIBILITY</span><h3 id={id}>{pick.dish.name}</h3></div>
      <div className="stretch-price"><strong>{money(pick.dish.price.amount_minor)}</strong><span>per dish</span></div></div>
      <p className="stretch-overage"><Icon name="info" size={14}/>{money(pick.budget.overage_minor)} above your {money(pick.budget.target_minor)} target</p>
      <p className="stretch-description">{pick.dish.description}</p>
      <div className="stretch-reason"><span className="stretch-kicker"><Icon name="spark" size={14}/> WHY IT EARNS A LOOK</span><p>{pick.why}</p>
        <span className="stretch-fit">{pick.compatibility.label}<span aria-hidden="true"> · </span>{pick.compatibility.description}</span></div>
      {bridge && bridge.status !== 'unavailable' && <TasteBridge bridge={bridge} dishName={pick.dish.name}/>}
      {!!pick.compatibility.differences.length && <p className="stretch-caveat"><Icon name="compass" size={16}/>{pick.compatibility.differences[0]}</p>}
      {!!pick.compatibility.uncertainties.length && <p className="stretch-limit">{pick.compatibility.uncertainties[0]}</p>}
      <details className="stretch-evidence"><summary><span>Behind this suggestion<small>Taste evidence & limitations</small></span><Icon name="plus" size={18}/></summary>
        <div><h4>The taste connection</h4><ul>{pick.compatibility.evidence.map((evidence, i) => <li key={i}><strong>{evidence.preference}</strong><p>{evidence.observation}</p></li>)}</ul>
          {!!pick.compatibility.differences.length && <><h4>What may feel different</h4><ul>{pick.compatibility.differences.map((value, i) => <li key={i}>{value}</li>)}</ul></>}
          {!!pick.compatibility.uncertainties.length && <><h4>Where the evidence ends</h4><ul>{pick.compatibility.uncertainties.map((value, i) => <li key={i}>{value}</li>)}</ul></>}
        </div></details>
    </div>
  </article>;
}

export function WorthTheStretch({ session }: { session: RecommendationSession }) {
  const id = useId();
  const picks = stretchPicks(session);
  if (!picks.length) return null;
  return <section className="worth-the-stretch" aria-labelledby={id} data-stretch-count={picks.length}>
    <header className="stretch-intro"><div><span className="stretch-kicker">A FINAL CONSIDERATION · DEMO</span><h2 id={id}>Worth the <em>Stretch</em></h2>
      <p>A little beyond your target. A connection worth exploring.</p></div>
      <div className="stretch-target"><span>Your per-dish target</span><strong>{money(session.constraints.max_price_minor)}</strong><small>Every difference, clearly shown.</small></div></header>
    <p className="stretch-context">Additional dishes from {session.restaurant.name}, held to the same taste and safety checks as your primary picks. These are alternatives to consider, not additions to your meal subtotal.</p>
    <div className="stretch-selection">{picks.map((pick, index) => <StretchDish key={session.id + pick.dish.id} pick={pick} index={index}/>)}</div>
    <p className="stretch-footnote">Curated demo comparisons · prices exclude tax, tip & other fees. You can hide all above-budget alternatives using the option at the top of this page.</p>
  </section>;
}
