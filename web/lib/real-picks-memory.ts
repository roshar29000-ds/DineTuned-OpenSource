import type { DiningEventWrite, RecommendationHistoryWrite, RealPersonalizedPick, RealPicksResult } from './contracts';
import { memoryId } from './memory/journal';

/** Convert validated real Picks to the existing private dining journal contract. */
export async function realActionRecords(owner: string, result: RealPicksResult, restaurantName: string,
  pick: RealPersonalizedPick, kind: DiningEventWrite['event_type']) {
  const selected = [...result.recommendations, ...(result.worth_the_stretch || [])];
  if (!selected.some(item => item.dish.id === pick.dish.id) || result.status !== 'ready') {
    throw new Error('This dish is no longer in the current selection.');
  }
  if (selected.some(item => item.price_minor > 100000)) {
    throw new Error('This menu price exceeds the dining journal’s current record range. No event was saved.');
  }
  const historyId = await memoryId(`${owner}:real:${result.request_id}:history`);
  const history: RecommendationHistoryWrite = { id: historyId, session_id: result.request_id,
    restaurant_id: result.restaurant_id, menu_version: result.menu_version, reported_provider: result.mode,
    dishes: selected.map(item => ({ id: item.dish.id, name: item.dish.name, category_id: item.dish.category_id,
      price: { amount_minor: item.price_minor, currency: 'USD', status: 'listed', basis: 'per_dish_before_tax_tip' } })) };
  const event: DiningEventWrite = { id: await memoryId(`${owner}:real:${result.request_id}:${pick.dish.id}:${kind}`),
    event_type: kind, restaurant_id: result.restaurant_id, restaurant_name: restaurantName,
    menu_version: result.menu_version, dish_id: pick.dish.id, dish_name: pick.dish.name,
    occurred_at: new Date().toISOString(), recommendation_id: historyId };
  return { history, event };
}
