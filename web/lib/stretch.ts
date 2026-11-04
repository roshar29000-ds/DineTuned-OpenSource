import type { PersonalizedDish, RecommendationSession, WorthTheStretchResult } from './contracts';
import { isContract } from './validation';

/** Response integrity only: no culinary scoring or interpretation in the browser.
 * A broken optional extension cannot replace or suppress the primary selection.
 * The caller also binds the enclosing session to the current request.
 */
export function stretchPicks(session: RecommendationSession): PersonalizedDish[] {
  const result = session.worth_the_stretch;
  if (!session.options.include_over_budget || !isContract<WorthTheStretchResult>('WorthTheStretchResult', result)
    || result.restaurant_id !== session.restaurant.id || result.menu_version !== session.menu_version
    || session.evaluation.restaurant_id !== session.restaurant.id || session.evaluation.menu_version !== session.menu_version) return [];
  const seen = new Set(session.recommendations.map(rec => rec.dish.id));
  const valid = result.picks.every(rec => {
    const price = rec.dish.price;
    const checks = session.evaluation.items.filter(item => item.item_id === rec.dish.id);
    if (seen.has(rec.dish.id) || session.refinement_result?.request.avoid_dish_ids.includes(rec.dish.id)
      || !rec.dish.available || price.status !== 'listed' || price.amount_minor === null
      || price.currency !== session.constraints.currency || price.amount_minor <= session.constraints.max_price_minor
      || rec.budget.target_minor !== session.constraints.max_price_minor || rec.budget.status !== 'above_target'
      || rec.budget.overage_minor !== price.amount_minor - session.constraints.max_price_minor
      || checks.length !== 1 || checks[0].reasons.some(reason => reason.code !== 'budget')
      || !rec.why.trim() || !rec.compatibility.evidence.length
      || (rec.taste_bridge && (rec.taste_bridge.restaurant_id !== session.restaurant.id
        || rec.taste_bridge.menu_version !== session.menu_version || rec.taste_bridge.dish_id !== rec.dish.id))) return false;
    seen.add(rec.dish.id);
    return true;
  });
  return valid ? result.picks : [];
}
