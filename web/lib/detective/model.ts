import type { AllergyProfile, DietaryRestriction, MediaAsset, TasteProfile } from '../contracts';
import { isContract } from '../validation';
import { initialTaste } from '../preferences';

export type ChoiceKey = 'anchors' | 'reasons' | 'contrast' | 'heat' | 'texture' | 'aromatics' | 'ingredients' | 'avoids' | 'cooking' | 'curiosity';
export type StepId = Exclude<ChoiceKey, 'avoids'> | 'boundaries' | 'review';
export type Choice = { id: string; label: string; detail?: string; motif?: MediaAsset['motif']; color?: string };
export type DetectiveAnswers = {
  choices: Record<ChoiceKey, string[]>;
  dietary_restrictions: DietaryRestriction[];
  allergies: AllergyProfile;
};
export type DetectiveDraft = { version: 3; answers: DetectiveAnswers; current: StepId; visited: StepId[] };
export type DetectiveRecord = { version: 3; engine: 'deterministic-v3.1'; answers: DetectiveAnswers; savedAt: string };

export const choices: Record<ChoiceKey, Choice[]> = {
  anchors: [
    { id: 'tacos', label: 'Crispy tacos', detail: 'The crunch. The contrast.', motif: 'tacos', color: '#f0dfbd' },
    { id: 'ramen', label: 'A bowl of ramen', detail: 'Broth worth slowing down for.', motif: 'noodles', color: '#e6dbca' },
    { id: 'curry', label: 'A fragrant curry', detail: 'Warmth, spice, and depth.', motif: 'curry', color: '#ead3b8' },
    { id: 'pasta', label: 'Creamy pasta', detail: 'Comfort, fork after fork.', motif: 'pasta', color: '#e9dfc6' },
    { id: 'salad', label: 'A bright grain salad', detail: 'Fresh herbs. A little zing.', motif: 'salad', color: '#dfe6cc' },
    { id: 'grill', label: 'Something from the grill', detail: 'Golden edges, a smoky finish.', motif: 'skewers', color: '#e1d8c6' },
  ],
  reasons: [
    { id: 'crisp', label: 'That first crunch', detail: 'A crisp edge makes the bite.' },
    { id: 'comfort', label: 'Rich, cozy flavors', detail: 'Round, full, and comforting.' },
    { id: 'bright', label: 'A bright finish', detail: 'Citrus, freshness, a little lift.' },
    { id: 'depth', label: 'Savory depth', detail: 'A broth or sauce with layers.' },
    { id: 'fragrant', label: 'The aroma', detail: 'Herbs and spices before the first bite.' },
    { id: 'ritual', label: 'The memory attached', detail: 'It feels like home. No sensory assumptions.' },
  ],
  contrast: [
    { id: 'rich', label: 'Velvety & comforting', detail: 'A creamy sauce, a slow Sunday.', motif: 'pasta', color: '#e9dfc6' },
    { id: 'bright', label: 'Bright & lively', detail: 'Lime, herbs, and a fresh finish.', motif: 'salad', color: '#dfe6cc' },
    { id: 'both', label: 'A little of both', detail: 'Contrast is the interesting part.' },
  ],
  heat: [
    { id: 'mild', label: 'Keep it mellow', detail: 'Plenty of flavor. Very little fire.' },
    { id: 'medium', label: 'A gentle glow', detail: 'Warmth that leaves room for everything else.' },
    { id: 'hot', label: 'Bring the heat', detail: 'Chili is part of the pleasure.' },
  ],
  texture: [
    { id: 'crisp', label: 'Crisp & crackly', detail: 'Golden edges, a satisfying snap.' },
    { id: 'silky', label: 'Silky & smooth', detail: 'Creamy sauces and delicate custards.' },
    { id: 'chewy', label: 'Springy & chewy', detail: 'Noodles with bounce, a little bite.' },
    { id: 'tender', label: 'Tender & yielding', detail: 'Slow-cooked, falling-apart softness.' },
  ],
  aromatics: [
    { id: 'herbs', label: 'Fresh, green herbs', detail: 'Basil, mint, cilantro; a fragrant lift.' },
    { id: 'spices', label: 'Warm, toasted spices', detail: 'Cumin, cardamom, a deeper perfume.' },
    { id: 'subtle', label: 'Keep the aroma subtle', detail: 'Let the other flavors take the lead.' },
  ],
  ingredients: [
    { id: 'citrus', label: 'Citrus' }, { id: 'herbs', label: 'Fresh herbs' },
    { id: 'mushrooms', label: 'Mushrooms' }, { id: 'garlic', label: 'Garlic' },
    { id: 'cheese', label: 'Cheese' }, { id: 'sweet', label: 'Sweet glazes' },
    { id: 'chili', label: 'Chili' }, { id: 'fermented', label: 'Fermented flavors' },
  ],
  avoids: [
    { id: 'citrus', label: 'Citrus' }, { id: 'herbs', label: 'Fresh herbs' },
    { id: 'mushrooms', label: 'Mushrooms' }, { id: 'garlic', label: 'Garlic' },
    { id: 'cheese', label: 'Cheese' }, { id: 'sweet', label: 'Sweet glazes' },
    { id: 'chili', label: 'Chili' }, { id: 'fermented', label: 'Fermented flavors' },
  ],
  cooking: [
    { id: 'grilled', label: 'Flame-grilled', detail: 'Char, smoke, caramelized edges.' },
    { id: 'roasted', label: 'Slow-roasted', detail: 'Golden, concentrated, gently sweet.' },
    { id: 'fried', label: 'Crisped & fried', detail: 'A golden crust and tender center.' },
    { id: 'braised', label: 'Slow-braised', detail: 'Deeply comforting and spoon-tender.' },
    { id: 'steamed', label: 'Gently steamed', detail: 'Delicate, clean, and light.' },
    { id: 'raw', label: 'Fresh & uncooked', detail: 'The ingredient in its own voice.' },
  ],
  curiosity: [
    { id: 'familiar', label: 'My favorites, perfected', detail: 'I know what I love. Start there.' },
    { id: 'bridge', label: 'One foot in the familiar', detail: 'A new dish with something I already love.' },
    { id: 'explore', label: 'Take me somewhere new', detail: 'Unfamiliar ingredients are an invitation.' },
  ],
};
export const stepLabels: Record<StepId, string> = {
  anchors: 'Your favorites', reasons: 'The good part', contrast: 'A delicious comparison', heat: 'Your kind of heat',
  texture: 'The perfect bite', aromatics: 'A fragrant detour', ingredients: 'Little details', cooking: 'In the kitchen',
  curiosity: 'Room for discovery', boundaries: 'Your essentials', review: 'Your tasting notes',
};
export const choiceKeys = Object.keys(choices) as ChoiceKey[];
export function newDraft(profile: TasteProfile, record: DetectiveRecord | null = null): DetectiveDraft {
  return { version: 3, current: 'anchors', visited: [], answers: {
    choices: Object.fromEntries(choiceKeys.map(key => [key, [...(record?.answers.choices[key] || [])]])) as DetectiveAnswers['choices'],
    dietary_restrictions: [...profile.dietary_restrictions], allergies: { ...profile.allergies, allergens: [...profile.allergies.allergens] },
  } };
}
export function activeSteps(answers: DetectiveAnswers): StepId[] {
  const c = answers.choices;
  const aromaticBranch = c.anchors.some(id => ['ramen', 'curry'].includes(id)) || c.reasons.includes('fragrant');
  return ['anchors', 'reasons', 'contrast', 'heat', 'texture', ...(aromaticBranch ? ['aromatics' as const] : []),
    'ingredients', 'cooking', 'curiosity', 'boundaries', 'review'];
}
export const isSingle = (key: ChoiceKey) => ['contrast', 'heat', 'aromatics', 'curiosity'].includes(key);
export function choose(draft: DetectiveDraft, key: ChoiceKey, id: string): DetectiveDraft {
  if (!choices[key].some(option => option.id === id)) return draft;
  const old = draft.answers.choices[key];
  if (key === 'anchors' && old.length === 3 && !old.includes(id)) return draft;
  const value = old.includes(id) ? old.filter(item => item !== id) : isSingle(key) ? [id] : [...old, id];
  const next = { ...draft, answers: { ...draft.answers, choices: { ...draft.answers.choices, [key]: value } } };
  if (key === 'ingredients' || key === 'avoids') {
    const opposite = key === 'ingredients' ? 'avoids' : 'ingredients';
    next.answers.choices[opposite] = next.answers.choices[opposite].filter(item => !value.includes(item));
  }
  if (!activeSteps(next.answers).includes('aromatics')) {
    next.answers.choices.aromatics = [];
    next.visited = next.visited.filter(step => step !== 'aromatics');
    if (next.current === 'aromatics') next.current = 'ingredients';
  }
  return next;
}
export const labelFor = (key: ChoiceKey, id: string) => choices[key].find(option => option.id === id)?.label || id;
export function answerSummary(id: StepId, answers: DetectiveAnswers) {
  if (id === 'review') return 'Ready when you are';
  if (id === 'boundaries') return `${answers.dietary_restrictions.length} dietary preferences · ${answers.allergies.allergens.length + (answers.allergies.other ? 1 : 0)} allergy notes`;
  const result = answers.choices[id].map(value => labelFor(id, value)).join(' · ');
  return id === 'ingredients' && answers.choices.avoids.length
    ? `${result || 'No favorites set'} / Prefer less: ${answers.choices.avoids.map(value => labelFor('avoids', value)).join(', ')}`
    : result || 'Still an open question';
}
function parseAnswers(value: unknown): DetectiveAnswers | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as DetectiveAnswers;
  if (!candidate.choices || typeof candidate.choices !== 'object') return null;
  for (const key of choiceKeys) {
    const list = candidate.choices[key];
    if (!Array.isArray(list) || list.some(id => !choices[key].some(option => option.id === id))
      || new Set(list).size !== list.length || (isSingle(key) && list.length > 1) || (key === 'anchors' && list.length > 3)) return null;
  }
  if (candidate.choices.ingredients.some(id => candidate.choices.avoids.includes(id))) return null;
  if (!isContract('TasteProfile', { ...initialTaste(), dietary_restrictions: candidate.dietary_restrictions, allergies: candidate.allergies })) return null;
  const clean: DetectiveAnswers = { choices: Object.fromEntries(choiceKeys.map(key => [key, [...candidate.choices[key]]])) as DetectiveAnswers['choices'],
    dietary_restrictions: [...candidate.dietary_restrictions], allergies: { ...candidate.allergies, allergens: [...candidate.allergies.allergens] } };
  if (!activeSteps(clean).includes('aromatics')) clean.choices.aromatics = [];
  return clean;
}
export function restoreDraft(value: unknown): DetectiveDraft | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as DetectiveDraft, answers = parseAnswers(data.answers);
  if (data.version !== 3 || !answers || !Object.hasOwn(stepLabels, data.current) || !Array.isArray(data.visited)
    || data.visited.some(step => !Object.hasOwn(stepLabels, step))) return null;
  const steps = activeSteps(answers);
  return { version: 3, answers, current: steps.includes(data.current) ? data.current : 'ingredients', visited: [...new Set(data.visited)].filter(step => steps.includes(step)) };
}
export function restoreDetective(value: unknown): DetectiveRecord | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as DetectiveRecord, answers = parseAnswers(data.answers);
  return data.version === 3 && data.engine === 'deterministic-v3.1' && answers && typeof data.savedAt === 'string' && Number.isFinite(Date.parse(data.savedAt))
    ? { version: 3, engine: data.engine, answers, savedAt: data.savedAt } : null;
}
