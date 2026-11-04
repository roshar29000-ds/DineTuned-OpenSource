import type { TasteDocument } from '../contracts';
import type { SavedState } from '../storage';
import { decodeContract } from '../validation';
import { restoreDetective } from '../detective/model';
import { recommendationEvidence } from '../recommendations';

export function profileFingerprint(state: Pick<SavedState, 'taste' | 'detective' | 'detectiveDraft' | 'tasteEdits' | 'constraints'>) {
  return JSON.stringify([state.taste, state.detective, state.detectiveDraft, state.tasteEdits,
    state.constraints.dietary_restrictions, state.constraints.allergies]);
}
/** Called only after explicit confirmation. Session preferences/feedback are retained. */
export function restoreTasteDocument(state: SavedState, raw: TasteDocument, expectedFingerprint: string): SavedState {
  if (profileFingerprint(state) !== expectedFingerprint) throw new Error('Your local Taste DNA changed. Review the restore again.');
  const doc = decodeContract<TasteDocument>('TasteDocument', raw);
  const detective = restoreDetective(doc.detective);
  if (doc.detective && !detective) throw new Error('These saved Detective answers need a newer app before they can be restored.');
  const supported = recommendationEvidence(detective, doc.edited_axes);
  if (Object.entries(supported).some(([key, values]) => JSON.stringify([...values].sort()) !== JSON.stringify([...doc.evidence[key as keyof typeof supported]].sort()))) {
    throw new Error('Saved taste evidence does not match the supported Detective answers. Nothing was replaced.');
  }
  const dietary_restrictions = [...new Set([...state.constraints.dietary_restrictions, ...state.taste.dietary_restrictions, ...doc.profile.dietary_restrictions])];
  const allergens = [...new Set([...state.constraints.allergies.allergens, ...state.taste.allergies.allergens, ...doc.profile.allergies.allergens])];
  const other = [...new Set([state.constraints.allergies.other, state.taste.allergies.other, doc.profile.allergies.other].filter(Boolean))].join('; ');
  if (other.length > 200) throw new Error('Combined allergy notes need review before restoring. Nothing was replaced.');
  const allergies = { allergens, other };
  return { ...state, taste: { ...doc.profile, dietary_restrictions, allergies },
    detective: detective ? { ...detective, answers: { ...detective.answers, dietary_restrictions, allergies } } : null,
    detectiveDraft: null, tasteEdits: { axes: doc.edited_axes, exploration: doc.exploration_edited },
    constraints: { ...state.constraints, dietary_restrictions, allergies }, selection: null };
}
