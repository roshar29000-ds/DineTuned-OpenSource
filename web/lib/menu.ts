import type { DiningConstraints, ItemEligibility, MenuCategory, MenuEvaluation, RestaurantMenu } from './contracts';

/** Bind server eligibility to this menu and the current controls; never re-rank dishes here. */
export function evaluationMatchesMenu(evaluation: MenuEvaluation, menu: RestaurantMenu, constraints: DiningConstraints): boolean {
  const actual = evaluation.constraints;
  const sameSet = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|');
  return evaluation.restaurant_id === menu.restaurant.id && evaluation.menu_version === menu.version
    && actual.max_price_minor === constraints.max_price_minor && actual.currency === constraints.currency
    && actual.mood === constraints.mood && actual.appetite === constraints.appetite
    && sameSet(actual.dietary_restrictions, constraints.dietary_restrictions)
    && sameSet(actual.allergies.allergens, constraints.allergies.allergens) && actual.allergies.other === constraints.allergies.other;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
export function eligibilityMap(evaluation: MenuEvaluation | null): Map<string, ItemEligibility> {
  return new Map(evaluation?.items.map(item => [item.item_id, item]) || []);
}
/** Presentation only: authoritative eligibility always comes from FastAPI. */
export function visibleCategories(categories: MenuCategory[], query: string, onlyMatches: boolean, evaluation: MenuEvaluation | null): MenuCategory[] {
  const matches = eligibilityMap(evaluation);
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return categories.map(category => ({ ...category, items: category.items.filter(item =>
    (!onlyMatches || matches.get(item.id)?.eligible === true)
    && terms.every(term => normalize([item.name, item.description, category.name, ...item.ingredients].join(' ')).includes(term))
  ) })).filter(category => category.items.length > 0);
}
