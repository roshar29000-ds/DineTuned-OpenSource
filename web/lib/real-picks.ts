import { ApiError } from './api';
import { decodeContract } from './validation';
import type { RealPicksCapability, RealPicksRequest, RealPicksResult } from './contracts';

export async function realPicksCapability(signal: AbortSignal): Promise<RealPicksCapability> {
  const response = await fetch('/api/dinetuned/real-picks/config', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Personalization availability could not be checked. No model request was made.');
  return decodeContract<RealPicksCapability>('RealPicksCapability', await response.json());
}

function same(a: unknown, b: unknown): boolean {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

export async function realPersonalizedPicks(request: RealPicksRequest, accessToken: () => Promise<string>, signal: AbortSignal): Promise<RealPicksResult> {
  if (!request.extraction.recommendation_token) throw new Error('This menu needs a current server-verified snapshot before personalization.');
  const token = await accessToken(); signal.throwIfAborted();
  const response = await fetch('/api/dinetuned/real-picks/sessions', { method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(request) });
  const data: unknown = await response.json().catch(() => null); signal.throwIfAborted();
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    throw new ApiError(typeof detail === 'string' ? detail : 'These picks could not be verified. No automatic retry was made.', response.status);
  }
  const result = decodeContract<RealPicksResult>('RealPicksResult', data), menu = request.extraction.menu;
  const items = new Map(menu.categories.flatMap(c => c.items.map(d => [d.id, { dish: d, category: c.name }] as const)));
  const evidence = new Map(menu.evidence.map(e => [e.id, e]));
  const primary = result.recommendations;
  const stretch = result.worth_the_stretch || [];
  const all = [...primary, ...stretch];
  const selectedIds = new Set(all.map(p => p.dish.id));
  const avoided = new Set(request.refinements.avoid_dish_ids);
  const validPick = (p: typeof all[number]) => {
    const expected = items.get(p.dish.id), option = expected?.dish.price.options[0];
    return !expected || !same(p.dish, expected.dish) || p.category_name !== expected.category
      || !option || expected.dish.price.kind !== 'fixed' || !expected.dish.price.budget_usable
      || option.currency !== 'USD' || p.price_minor !== option.amount_minor || avoided.has(p.dish.id)
      || p.budget.target_minor !== request.constraints.max_price_minor
      || p.budget.overage_minor !== Math.max(0, p.price_minor - request.constraints.max_price_minor)
      || p.budget.status !== (p.budget.overage_minor ? 'above_target' : 'within_target')
      || p.budget.overage_minor > 0 && (p.fit !== 'exceptional' || !request.options.include_over_budget)
      || !p.connections.length || p.connections.some(c => !p.dish.evidence_ids.includes(c.evidence.id)
        || !same(c.evidence, evidence.get(c.evidence.id)) || p.dish[c.field] !== c.menu_quote);
  };
  if (result.request_id !== request.request_id || result.restaurant_id !== menu.restaurant_id || result.menu_version !== menu.version
    || (result.status === 'ready') !== !!primary.length
    || result.mode === 'not_run' && all.length > 0
    || new Set(all.map(p => p.dish.id)).size !== all.length
    || all.some(validPick)
    || stretch.some(p => !p.budget.overage_minor)
    || (result.taste_bridges || []).some(bridge => {
      const pick = all.find(p => p.dish.id === bridge.item_id);
      return !pick || !pick.connections.some(connection => same(connection.preference, bridge.anchor)
        && connection.menu_quote === bridge.menu_quote && same(connection.evidence, bridge.evidence));
    })
    || (result.meal_combinations || []).some(table => {
      const main = primary.find(p => p.dish.id === table.main_item_id);
      const ids = table.additions.map(a => a.dish.id);
      return !main || new Set(ids).size !== ids.length || ids.some(id => selectedIds.has(id) || avoided.has(id))
        || table.additions.some(a => {
          const expected = items.get(a.dish.id), price = expected?.dish.price.options[0];
          return !expected || !same(a.dish, expected.dish) || a.category_name !== expected.category
            || !price || expected.dish.price.kind !== 'fixed' || !expected.dish.price.budget_usable
            || price.currency !== 'USD' || a.price_minor !== price.amount_minor
            || !a.dish.evidence_ids.includes(a.evidence.id) || !same(a.evidence, evidence.get(a.evidence.id));
        }) || table.subtotal_minor !== main.price_minor + table.additions.reduce((sum, a) => sum + a.price_minor, 0);
    })) throw new Error('The picks did not match this request, menu, price or source evidence. No substitute dishes were shown.');
  return result;
}
