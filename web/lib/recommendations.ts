import type { BridgeFeedback, MealFeedback, RecommendationRequest, RecommendationSession, RecommendationTasteEvidence } from './contracts';
import { isContract } from './validation';
import { demoDetective } from './detective/engine';
import type { DetectiveRecord } from './detective/model';
import { axisNames, type Axis } from './preferences';
import { emptyRefinements } from './refinements';

/** Send saved structured notes, never an unfinished interview or invented free-text interpretation. */
export function recommendationEvidence(record: DetectiveRecord | null, editedAxes: Axis[]): RecommendationTasteEvidence {
  const c = record?.answers.choices;
  const reading = record ? demoDetective.analyze(record.answers) : null;
  return {
    favorite_dishes: (c?.anchors || []) as RecommendationTasteEvidence['favorite_dishes'],
    textures: (c?.texture || []) as RecommendationTasteEvidence['textures'],
    cooking_methods: (c?.cooking || []) as RecommendationTasteEvidence['cooking_methods'],
    liked_ingredients: (c?.ingredients || []) as RecommendationTasteEvidence['liked_ingredients'],
    disliked_ingredients: (c?.avoids || []) as RecommendationTasteEvidence['disliked_ingredients'],
    inferred_axes: reading ? axisNames.filter(axis => reading.axes[axis].basis === 'inferred' && !editedAxes.includes(axis)) : [],
  };
}
/** Bounded reported ratings only. No free-text feedback is sent to a reasoner. */
export function bridgeFeedback(records: MealFeedback[]): BridgeFeedback[] {
  return records.flatMap(record => {
    const candidate = { id: record.id, restaurant_id: record.restaurant_id, dish_id: record.dish_id,
      menu_version: record.menu_version ?? null, liked: record.liked, date: record.date };
    return isContract<BridgeFeedback>('BridgeFeedback', candidate) ? [candidate] : [];
  }).slice(0, 20);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(stable));
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  return JSON.stringify(value);
}
/** Shape validation alone cannot bind a valid response to the current restaurant or taste. */
export function sessionMatchesRequest(session: RecommendationSession, request: RecommendationRequest): boolean {
  const constraints = { ...request.constraints,
    dietary_restrictions: [...new Set([...request.profile.dietary_restrictions, ...request.constraints.dietary_restrictions])],
    allergies: {
      allergens: [...new Set([...request.profile.allergies.allergens, ...request.constraints.allergies.allergens])],
      other: [...new Set([request.profile.allergies.other.trim(), request.constraints.allergies.other.trim()].filter(Boolean))].join('; '),
    },
  };
  const profile = { ...request.profile, allergies: { ...request.profile.allergies, other: request.profile.allergies.other.trim() } };
  // Server timestamps can serialize UTC as Z or +00:00; both describe the same saved evidence.
  const normalizeProfile = (value: typeof profile) => ({ ...value, updated_at: value.updated_at ? new Date(value.updated_at).toISOString() : null });
  const normalizeFeedback = (values: BridgeFeedback[] = []) => values.map(value => ({ ...value, date: new Date(value.date).toISOString() }));
  return session.restaurant.id === request.restaurant_id && session.menu_version === request.menu_version
    && stable(session.refinement_result?.request ?? emptyRefinements()) === stable(request.refinements ?? emptyRefinements())
    && stable(session.constraints) === stable(constraints) && stable(session.options) === stable(request.options)
    && stable(session.taste_evidence) === stable(request.taste_evidence)
    && stable(normalizeFeedback(session.bridge_feedback)) === stable(normalizeFeedback(request.bridge_feedback))
    && stable(normalizeProfile(session.profile)) === stable(normalizeProfile(profile))
    && session.recommendations.length <= 3 && new Set(session.recommendations.map(rec => rec.dish.id)).size === session.recommendations.length
    && session.recommendations.every(rec => !request.refinements?.avoid_dish_ids.includes(rec.dish.id) && rec.dish.price.amount_minor !== null
      && rec.budget.target_minor === constraints.max_price_minor
      && rec.budget.overage_minor === Math.max(0, rec.dish.price.amount_minor - constraints.max_price_minor)
      && rec.budget.status === (rec.budget.overage_minor > 0 ? 'above_target' : 'within_target')
      && (!rec.taste_bridge || (rec.taste_bridge.restaurant_id === request.restaurant_id
        && rec.taste_bridge.menu_version === request.menu_version && rec.taste_bridge.dish_id === rec.dish.id))
      && (request.options.include_over_budget || rec.budget.overage_minor === 0));
}
