'use client';
import type { Recommendation, RecommendationSession } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { DishArt } from '../DishArt';
import { Icon } from '../UI';
import { DishExperience } from '../memory/DishExperience';
import { TasteBridge } from './TasteBridge';

export function RecommendationCard({ recommendation: rec, session, index = 0 }: { recommendation: Recommendation; session: RecommendationSession; index?: number }) {
  const above = rec.budget.status === 'above_target';
  return <article className={'signature-pick v2-pick ' + (index === 0 ? 'signature-lead' : '')} data-pick-id={rec.dish.id}>
    <div className="pp-dish-visual"><DishArt name={rec.dish.name} media={rec.dish.media} seed={rec.dish.id}/>
      <span className="pp-pick-number">{String(index + 1).padStart(2, '0')}<small>THE PERSONAL EDIT</small></span></div>
    <div className="pp-dish-story"><div className="pp-card-overline"><span>{['A FIRST INVITATION', 'ANOTHER DIRECTION', 'ONE MORE POSSIBILITY'][index]}</span><Icon name={index === 0 ? 'star' : index === 1 ? 'heart' : 'compass'} size={17}/></div>
      <div className="pp-dish-heading"><h2>{rec.dish.name}</h2><span className="pp-price">{money(rec.dish.price.amount_minor)}<small>per dish</small></span></div>
      <span className={'pp-budget-position ' + (above ? 'above' : 'within')}><Icon name={above ? 'info' : 'check'} size={14}/>{above ? `${money(rec.budget.overage_minor)} above your ${money(rec.budget.target_minor)} target` : 'Within your target'}</span>
      <p className="pp-dish-description">{rec.dish.description}</p>
      <div className="pp-flavors">{rec.dish.labels.map(label => <span key={label}>{label}</span>)}<span>{rec.dish.portion === 'light' ? 'Light portion' : 'Hearty portion'}</span></div>
      <TasteBridge bridge={rec.taste_bridge} dishName={rec.dish.name}/>
      <div className="pp-compatibility"><span className="pp-compatibility-mark" aria-hidden="true"><i/><i/><i/></span><div><strong>{rec.compatibility.label}</strong><span>{rec.compatibility.description}</span></div></div>
      {rec.compatibility.differences.length > 0 && <p className="pp-one-caveat"><Icon name="info" size={15}/>{rec.compatibility.differences[0]}</p>}
      <details className="pp-evidence"><summary>Evidence & unknowns <Icon name="plus" size={16}/></summary><div>
        <h3>Why this pick</h3><p>{rec.why}</p>
        <ul className="pp-evidence-list">{rec.compatibility.evidence.map((evidence, i) => <li key={i}><strong>{evidence.preference}</strong><p>{evidence.observation}</p></li>)}</ul>
        {rec.compatibility.differences.length > 0 && <><h3>What may feel different</h3><ul>{rec.compatibility.differences.map(value => <li key={value}>{value}</li>)}</ul></>}
        <h3>Where the evidence ends</h3><ul>{rec.compatibility.uncertainties.map(value => <li key={value}>{value}</li>)}</ul>
      </div></details>
      <DishExperience recommendation={rec} session={session}/>
    </div>
  </article>;
}
