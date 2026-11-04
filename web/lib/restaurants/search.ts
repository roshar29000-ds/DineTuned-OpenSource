import type { RestaurantSearch, RestaurantSummary } from '../contracts';
import { apiRequest } from '../api';

export type SearchLocation = { latitude: number; longitude: number };
export type RestaurantMatch = Omit<RestaurantSummary, 'is_demo'> & { is_demo: boolean; branch: string; address: string | null; provider: 'demo' | 'google_places' };
export type RestaurantSearchInput = { query: string; cuisine: string; location: SearchLocation | null };
export interface RestaurantSearchProvider {
  readonly id: 'demo' | 'google_places';
  search(input: RestaurantSearchInput, signal: AbortSignal): Promise<{ matches: RestaurantMatch[]; locationApplied: boolean }>;
}
// Supplemental fictional address labels only. Names, menus, ordering and IDs stay server-owned.
const demoAddresses: Record<string, string> = {
  'saigon-table': '12 Lantern Lane', 'saigon-table-river-north': '84 Willow Walk',
  'casa-sol': '28 Marigold Court', 'luna-trattoria': '46 Olive Row',
  'sora-kitchen': '17 Cedar Passage', 'spice-garden': '63 Saffron Way',
};
export function presentRestaurant(restaurant: RestaurantSummary): RestaurantMatch {
  return { ...restaurant, branch: restaurant.area, provider: 'demo',
    address: demoAddresses[restaurant.id] ? `${demoAddresses[restaurant.id]}, ${restaurant.city}` : null };
}
export function searchParameters(input: RestaurantSearchInput) {
  const params = new URLSearchParams({ q: [input.query.trim().slice(0, 80), input.cuisine === 'All' ? '' : input.cuisine].filter(Boolean).join(' ') });
  if (input.location) {
    params.set('latitude', String(input.location.latitude));
    params.set('longitude', String(input.location.longitude));
  }
  return params;
}
const hints = new Map<string, RestaurantMatch>();
export const restaurantHint = (id: string) => hints.get(id) || null;
export const demoRestaurantSearch: RestaurantSearchProvider = {
  id: 'demo',
  async search(input, signal) {
    const data = await apiRequest<RestaurantSearch>('restaurants?' + searchParameters(input), 'RestaurantSearch', undefined, signal);
    const matches = data.restaurants.map(presentRestaurant);
    if (!signal.aborted) matches.forEach(match => hints.set(match.id, match));
    return { matches, locationApplied: data.location_applied };
  },
};
