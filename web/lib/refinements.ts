import type { RefinementRequest, RecommendationSession } from './contracts';

export const emptyRefinements = (): RefinementRequest => ({ preferences: [], avoid_dish_ids: [] });
export const hasRefinements = (value: RefinementRequest) => !!(value.preferences.length || value.avoid_dish_ids.length);
export const refinementChoices = [
  { id: 'less_creamy', label: 'Less creamy', hint: 'Ease away from creamy labels', icon: 'sun' },
  { id: 'lighter', label: 'Something lighter', hint: 'Lean toward light portions', icon: 'leaf' },
  { id: 'spicier', label: 'More spicy', hint: 'Explore a little more heat', icon: 'fire' },
  { id: 'adventurous', label: 'More adventurous', hint: 'Take a different direction', icon: 'compass' },
] as const;
/** Maps a small set of plain-language requests to the existing validated refinement contract. */
export function supportedRefinement(text: string): RefinementRequest['preferences'][number] | null {
  const phrase = text.trim().toLowerCase();
  if (/\b(?:less|no|without)\s+cream(?:y)?\b/.test(phrase)) return 'less_creamy';
  if (/\b(?:something\s+)?lighter\b|\blight(?:er)?\s+(?:dish|meal)\b/.test(phrase)) return 'lighter';
  if (/\bmore\s+spic(?:y|e)\b|\bspicier\b|\bhotter\b/.test(phrase)) return 'spicier';
  if (/\bmore\s+adventurous\b|\bbolder\b|\bmore\s+unusual\b/.test(phrase)) return 'adventurous';
  return null;
}
export function toggleRefinement(value: RefinementRequest, preference: RefinementRequest['preferences'][number]): RefinementRequest {
  const selected = new Set(value.preferences);
  if (selected.has(preference)) selected.delete(preference); else selected.add(preference);
  return { ...value, preferences: refinementChoices.map(choice => choice.id).filter(id => selected.has(id)) };
}
export function tryAnother(value: RefinementRequest, session: RecommendationSession): RefinementRequest | null {
  const ids = [...new Set([...value.avoid_dish_ids, ...session.recommendations.map(rec => rec.dish.id)])];
  if (ids.length > 50 || ids.length === value.avoid_dish_ids.length) return null;
  return { ...value, avoid_dish_ids: ids };
}
