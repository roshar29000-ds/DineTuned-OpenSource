import type { MealCombination, MealCombinationResult, MealComponent, MediaAsset, RecommendationSession, RestaurantMenu } from './contracts';
import { isContract } from './validation';

export type TableFallback = MealCombinationResult['unavailable_reason'] | 'missing' | 'unverified' | 'menu_changed';
export type TablePresentation = { combinations: MealCombination[]; limited: boolean; fallback: TableFallback };

/** Bind optional presentation data to the already-validated Picks session.
 * No culinary interpretation, eligibility decisions, ranking or subtotal calculation.
 */
export function tablePresentation(session: RecommendationSession): TablePresentation {
  const empty = (fallback: TableFallback): TablePresentation => ({ combinations: [], limited: false, fallback });
  const result = session.meal_combinations;
  if (!result) return empty('missing');
  if (!isContract<MealCombinationResult>('MealCombinationResult', result)
    || result.restaurant_id !== session.restaurant.id || result.menu_version !== session.menu_version) return empty('unverified');
  if (result.status === 'unavailable') return empty(result.unavailable_reason || 'insufficient_menu_evidence');
  if (result.unavailable_reason !== null) return empty('unverified');
  const mains = new Map(session.recommendations.map(rec => [rec.dish.id, rec]));
  const seen = new Set<string>(), usedMains = new Set<string>();
  const combinations = result.combinations.filter(combination => {
    const primary = mains.get(combination.main.item_id);
    const parts = [combination.main, ...combination.additions];
    const ids = new Set(parts.map(part => part.item_id));
    if (!primary || combination.restaurant_id !== session.restaurant.id || combination.menu_version !== session.menu_version
      || seen.has(combination.id) || usedMains.has(combination.main.item_id) || ids.size !== parts.length
      || combination.main.name !== primary.dish.name || combination.main.category_id !== primary.dish.category_id
      || combination.main.price_minor !== primary.dish.price.amount_minor
      || combination.main.budget.overage_minor !== primary.budget.overage_minor || combination.main.budget.status !== primary.budget.status || !combination.rationale.trim()
      || parts.some(part => session.refinement_result?.request.avoid_dish_ids.includes(part.item_id)
        || !part.name.trim() || !part.category_name.trim() || part.currency !== session.constraints.currency
        || part.budget.target_minor !== session.constraints.max_price_minor
        || (!session.options.include_over_budget && part.budget.status === 'above_target'))) return false;
    const facts = new Map(combination.evidence.map(fact => [fact.id, fact]));
    if (facts.size !== combination.evidence.length || combination.evidence.some(fact => fact.item_id !== null && !ids.has(fact.item_id))) return false;
    if (combination.claims.some(claim => {
      const left = facts.get(claim.left_fact_id), right = facts.get(claim.right_fact_id);
      return !left || !right || !claim.text.trim() || left.attribute !== right.attribute
        || right.item_id === null || !combination.additions.some(part => part.item_id === right.item_id);
    })) return false;
    const connected = new Set(combination.claims.filter(claim => facts.get(claim.left_fact_id)?.item_id === combination.main.item_id)
      .map(claim => facts.get(claim.right_fact_id)?.item_id));
    if (combination.additions.some(part => !connected.has(part.item_id))) return false;
    seen.add(combination.id); usedMains.add(combination.main.item_id);
    return true;
  });
  return combinations.length ? { combinations, limited: result.status === 'limited' || combinations.length < result.combinations.length, fallback: null }
    : empty(result.combinations.length ? 'unverified' : 'insufficient_menu_evidence');
}

/** Portion is an explicit backend fact, never a guess from the category or price. */
export function tablePortion(combination: MealCombination, itemId: string): 'light' | 'hearty' | null {
  const values = new Set(combination.evidence.filter(fact => fact.item_id === itemId && fact.attribute === 'portion' && fact.source === 'menu_fixture').map(fact => fact.value));
  const value = [...values][0];
  return values.size === 1 && (value === 'light' || value === 'hearty') ? value : null;
}

export function tableMenuMatches(session: RecommendationSession, menu: RestaurantMenu): boolean {
  return menu.restaurant.id === session.restaurant.id && menu.version === session.menu_version;
}

/** Reuse only exact menu assets. Unavailable artwork stays an honest empty plate. */
export function tableMedia(part: MealComponent, session: RecommendationSession, menu: RestaurantMenu | null): MediaAsset | undefined {
  const primary = session.recommendations.find(rec => rec.dish.id === part.item_id);
  if (primary && primary.dish.name === part.name && primary.dish.price.amount_minor === part.price_minor) return primary.dish.media;
  if (!menu || !tableMenuMatches(session, menu)) return undefined;
  const matches = menu.categories.flatMap(category => category.items).filter(item => item.id === part.item_id);
  const item = matches.length === 1 ? matches[0] : null;
  return item && item.name === part.name && item.category_id === part.category_id && item.price.amount_minor === part.price_minor ? item.media : undefined;
}

export function tableFallback(reason: TableFallback): string {
  if (reason === 'provider_unavailable') return 'Your table suggestions are temporarily unavailable. Your personal picks are still here to enjoy.';
  if (reason === 'menu_changed') return 'This menu has changed. Revisit the complete menu for a fresh selection.';
  if (reason === 'invalid_context' || reason === 'invalid_proposal' || reason === 'unverified') return 'We couldn’t verify a complete pairing for this selection. Your personal picks remain available above.';
  if (reason === 'no_primary_picks') return 'Once a primary dish fits your preferences, we can look for something to enjoy alongside it.';
  return 'There isn’t a supported accompaniment for this selection just yet. We’ll leave room rather than add something without a reason.';
}
