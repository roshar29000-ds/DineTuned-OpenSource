import type { ItemEligibility, MenuItem } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { DishArt } from '../DishArt';
import { Icon } from '../UI';

export function MenuItemCard({ item, eligibility, index, checksUnavailable = false }: { item: MenuItem; eligibility?: ItemEligibility; index: number; checksUnavailable?: boolean }) {
  const vegetarian = item.dietary.some(e => e.restriction === 'vegetarian' && e.status === 'supported');
  return <article className={`smart-dish-card ${eligibility && !eligibility.eligible ? 'outside-filters' : ''}`} data-dish-id={item.id}>
    <div className="smart-dish-art"><DishArt name={item.name} media={item.media} seed={item.id}/>
      <span className="dish-number">{String(index + 1).padStart(2, '0')}</span>
      {vegetarian && <span className="dish-vegetarian"><Icon name="leaf" size={14}/><span>Vegetarian example</span></span>}
    </div>
    <div className="smart-dish-body">
      <div className="dish-title-row"><h3>{item.name}</h3><strong className="dish-price">{money(item.price.amount_minor)}</strong></div>
      {!item.available && <span className="dish-unavailable">Currently unavailable</span>}
      <p className="dish-description">{item.description}</p>
      <div className="dish-flavors">{item.labels.map(label => <span key={label}>{label}</span>)}</div>
      <div className={`dish-eligibility ${eligibility?.eligible ? 'matches' : 'needs-review'}`}>
        <Icon name={eligibility?.eligible ? 'check' : 'info'} size={14}/>
        <span>{checksUnavailable ? 'Preference check unavailable' : !eligibility ? 'Checking preferences…' : eligibility.eligible ? 'Matches your filters' : eligibility.reasons[0]?.message || 'Outside your current filters'}</span>
      </div>
      <details className="dish-details"><summary>Ingredients & details <Icon name="plus" size={15}/></summary>
        <div><p><strong>Listed ingredients</strong><br/>{item.ingredients.join(', ')}.</p>
          <p><strong>Allergen information is incomplete.</strong> {item.allergens.contains.length ? 'Listed examples: ' + item.allergens.contains.map(a => a.replace('_', ' ')).join(', ') + '. ' : ''}
            Absence from this list does not mean absence from the dish. Cross-contact is unknown.</p>
          {eligibility && eligibility.reasons.length > 0 && <ul className="exclusion-reasons">{eligibility.reasons.map((reason, i) => <li key={reason.code+i}>{reason.message}</li>)}</ul>}
          <p className="control-hint">Illustrative ingredients, prices, and artwork. Confirm details with the restaurant.</p>
        </div>
      </details>
    </div>
  </article>;
}
