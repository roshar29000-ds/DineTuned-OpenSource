import type { DiningConstraints, MealFeedback, RecommendationOptions, TasteProfile } from './contracts';
import { isContract } from './validation';
import { axisNames, initialConstraints, initialTaste, type Axis } from './preferences';
import { restoreDetective, restoreDraft, type DetectiveDraft, type DetectiveRecord } from './detective/model';

export const STORAGE_KEY = 'dinetuned-v2';
export const LEGACY_KEY = 'dinetuned-demo-v1';
export type MenuSelection = { restaurant_id: string; menu_version: string };
export type SavedState = {
  version: 2; taste: TasteProfile; constraints: DiningConstraints;
  selection: MenuSelection | null; feedback: MealFeedback[];
  detective: DetectiveRecord | null; detectiveDraft: DetectiveDraft | null;
  tasteEdits: { axes: Axis[]; exploration: boolean };
  recommendationOptions: RecommendationOptions;
};
export function initialState(): SavedState {
  return { version: 2, taste: initialTaste(), constraints: initialConstraints(), selection: null, feedback: [], detective: null, detectiveDraft: null, tasteEdits: { axes: [], exploration: false }, recommendationOptions: { protein_preference: 'any', include_over_budget: true } };
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function restoreState(raw: string | null, legacy: string | null): SavedState {
  const state = initialState();
  try {
    if (raw) {
      const data = record(JSON.parse(raw));
      if (data.version !== 2) return state;
      if (isContract<TasteProfile>('TasteProfile', data.taste)) state.taste = data.taste;
      if (isContract<DiningConstraints>('DiningConstraints', data.constraints)) state.constraints = data.constraints;
      if (isContract<RecommendationOptions>('RecommendationOptions', data.recommendationOptions)) state.recommendationOptions = data.recommendationOptions;
      state.detective = restoreDetective(data.detective);
      state.detectiveDraft = restoreDraft(data.detectiveDraft);
      const edits = record(data.tasteEdits);
      state.tasteEdits = { axes: Array.isArray(edits.axes) ? axisNames.filter(axis => edits.axes instanceof Array && edits.axes.includes(axis)) : [], exploration: edits.exploration === true };
      state.feedback = Array.isArray(data.feedback) ? data.feedback.flatMap(f => {
        const candidate: unknown = { menu_version: null, ...record(f) };
        return isContract<MealFeedback>('MealFeedback', candidate) ? [candidate] : [];
      }) : [];
      const selection = record(data.selection);
      if (typeof selection.restaurant_id === 'string' && /^[a-z0-9-]{1,100}$/.test(selection.restaurant_id)
        && typeof selection.menu_version === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(selection.menu_version)) {
        state.selection = { restaurant_id: selection.restaurant_id, menu_version: selection.menu_version };
      }
      // Synchronize hard constraints; malformed storage must not silently erase saved allergies.
      state.constraints.dietary_restrictions = [...new Set([...state.taste.dietary_restrictions, ...state.constraints.dietary_restrictions])];
      state.constraints.allergies.allergens = [...new Set([...state.taste.allergies.allergens, ...state.constraints.allergies.allergens])];
      state.constraints.allergies.other = [...new Set([state.taste.allergies.other, state.constraints.allergies.other].filter(Boolean))].join('; ').slice(0, 200);
      state.taste.dietary_restrictions = state.constraints.dietary_restrictions;
      state.taste.allergies = state.constraints.allergies;
      return state;
    }
    if (!legacy) return state;
    const data = record(JSON.parse(legacy));
    const taste = record(data.taste), axes = record(taste.axes);
    state.taste.complete = taste.complete === true;
    state.taste.favorites = text(taste.favorites, 2000);
    state.taste.updated_at = date(taste.updatedAt);
    state.taste.source = 'migrated';
    for (const axis of axisNames) {
      const value = axes[axis];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) state.taste.axes[axis] = value / 100;
    }
    if (typeof axes.adventure === 'number' && axes.adventure >= 0 && axes.adventure <= 100) state.taste.exploration = axes.adventure / 100;
    const diet = taste.diet === 'vegetarian' ? 'vegetarian' : taste.diet === 'no-beef' ? 'no_beef' : taste.diet === 'no-pork' ? 'no_pork' : null;
    if (diet) state.constraints.dietary_restrictions = [diet];
    state.taste.dietary_restrictions = state.constraints.dietary_restrictions;
    if (typeof data.budget === 'number' && data.budget >= 0 && data.budget <= 1000) state.constraints.max_price_minor = Math.round(data.budget * 100);
    state.constraints.mood = data.mood === 'Something cozy' ? 'cozy' : data.mood === 'Light & fresh' ? 'fresh' : data.mood === 'Bold flavors' ? 'bold' : 'open';
    if (Array.isArray(data.feedback)) {
      state.feedback = data.feedback.flatMap(value => {
        const f = record(value);
        const migrated = { id: text(f.id, 100), restaurant_id: null, restaurant_name: text(f.restaurantName, 200),
          dish_id: text(f.dishId, 100), dish_name: text(f.dishName, 200), liked: f.liked,
          note: text(f.note, 1000), date: date(f.date), menu_version: null };
        return isContract<MealFeedback>('MealFeedback', migrated) ? [migrated] : [];
      });
    }
    // Old defaults do not prove that the user reviewed a menu. Require an explicit new menu visit.
    return state;
  } catch { return state; }
}
