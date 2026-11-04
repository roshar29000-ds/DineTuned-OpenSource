import { apiRequest } from '../api';
import type { RestaurantMenu } from '../contracts';
import { assessMenu, type MenuAssessment } from './quality';

export type RetrievalStage = 'finding' | 'reading' | 'organizing' | 'checking';
export type RetrievalProgress = { stage: RetrievalStage; menu: RestaurantMenu | null };
export type MenuRetrievalResult = { menu: RestaurantMenu; assessment: MenuAssessment; preview: { category: string; itemCount: number; dishes: string[] }[] };
export interface MenuRetrievalProvider {
  retrieve(id: string, signal: AbortSignal, progress: (value: RetrievalProgress) => void): Promise<MenuRetrievalResult>;
}
export const retrievalStages: { id: RetrievalStage; label: string; detail: string }[] = [
  { id: 'finding', label: 'Finding menu', detail: 'Opening the selected branch’s sample menu.' },
  { id: 'reading', label: 'Reading menu', detail: 'Reading and validating the saved menu details.' },
  { id: 'organizing', label: 'Organizing dishes', detail: 'Preparing the supplied dish categories for browsing.' },
  { id: 'checking', label: 'Checking accuracy', detail: 'Checking the sample’s completeness, prices, and consistency. Not real-world verification.' },
];
export const demoMenuProvider: MenuRetrievalProvider = {
  async retrieve(id, signal, progress) {
    progress({ stage: 'finding', menu: null });
    const menu = await apiRequest<RestaurantMenu>('restaurants/' + encodeURIComponent(id) + '/menu', 'RestaurantMenu', undefined, signal,
      () => progress({ stage: 'reading', menu: null }));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const matchingMenu = menu.restaurant.id === id ? menu : null;
    progress({ stage: 'organizing', menu: matchingMenu });
    const preview = menu.categories.map(category => ({ category: category.name, itemCount: category.items.length,
      dishes: category.items.slice(0, 2).map(item => item.name) }));
    // These are immediate local operations, not an imitation of slow AI extraction.
    progress({ stage: 'checking', menu: matchingMenu });
    const assessment = assessMenu(menu, id);
    return { menu, assessment, preview };
  },
};
