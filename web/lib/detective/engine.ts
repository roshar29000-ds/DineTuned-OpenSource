import type { TasteAnswers, TasteAxes, TasteProfile } from '../contracts';
import { axisNames, initialTaste, type Axis } from '../preferences';
import { answerSummary, labelFor, type DetectiveAnswers, type StepId } from './model';

export type Signal = { value: number | null; basis: 'stated' | 'inferred' | 'unknown'; confidence: 'Direct' | 'Tentative' | 'Open'; evidence: string[] };
export type TasteReading = { engine: 'deterministic-v3.1'; axes: Record<Axis, Signal>; exploration: number | null; observations: string[] };
/** Replaceable seam for a future Python intelligence service. No model or network calls. */
export interface DetectiveEngine { analyze(answers: DetectiveAnswers): TasteReading }

export const demoDetective: DetectiveEngine = {
  analyze(answers) {
    const c = answers.choices;
    const axes = Object.fromEntries(axisNames.map(axis => [axis, { value: null, basis: 'unknown', confidence: 'Open', evidence: [] } as Signal])) as TasteReading['axes'];
    const infer = (axis: Axis, value: number, evidence: string) => {
      const signal = axes[axis];
      if (signal.value === null) axes[axis] = { value, basis: 'inferred', confidence: 'Tentative', evidence: [evidence] };
      else if (signal.basis === 'inferred') {
        // Equal-weight demo clues, never statistical confidence or a measured taste score.
        signal.value = Math.round((signal.value * signal.evidence.length + value) / (signal.evidence.length + 1) * 100) / 100;
        signal.evidence.push(evidence);
      }
    };
    const stated = (axis: Axis, value: number, evidence: string) => {
      axes[axis] = { value, basis: 'stated', confidence: 'Direct', evidence: [evidence] };
    };
    const reasonRules: Record<string, [Axis, number]> = { crisp: ['crunch', .85], comfort: ['richness', .85], bright: ['freshness', .85], depth: ['umami', .85], fragrant: ['aromatic', .8] };
    for (const reason of c.reasons) {
      const rule = reasonRules[reason];
      if (rule) infer(...rule, `You enjoy “${labelFor('reasons', reason)}” in your favorites.`);
    }
    const ingredientRules: Record<string, [Axis, number]> = { citrus: ['freshness', .8], herbs: ['aromatic', .8], mushrooms: ['umami', .8],
      garlic: ['aromatic', .8], cheese: ['richness', .8], sweet: ['sweetness', .8], chili: ['spice', .8], fermented: ['umami', .8] };
    for (const id of c.ingredients) infer(...ingredientRules[id], `You tend to enjoy ${labelFor('ingredients', id).toLowerCase()}.`);
    // A disliked ingredient does not mean dislike of an entire sensory dimension.
    if (c.avoids.includes('sweet')) stated('sweetness', .18, 'You prefer less sweet glaze in savory dishes.');
    if (c.cooking.includes('fried')) infer('crunch', .8, 'You enjoy crisped & fried preparations.');
    if (c.cooking.includes('raw')) infer('freshness', .8, 'You enjoy fresh & uncooked preparations.');
    if (c.cooking.includes('braised')) infer('richness', .75, 'You enjoy slow-braised preparations.');
    const contrast = c.contrast[0];
    if (contrast) {
      stated('richness', contrast === 'rich' ? .87 : contrast === 'bright' ? .3 : .55, `In the comparison, you chose ${labelFor('contrast', contrast).toLowerCase()}.`);
      stated('freshness', contrast === 'bright' ? .91 : contrast === 'rich' ? .35 : .55, `In the comparison, you chose ${labelFor('contrast', contrast).toLowerCase()}.`);
    }
    const heat = c.heat[0];
    if (heat) stated('spice', { mild: .18, medium: .55, hot: .89 }[heat]!, `Your heat preference: ${labelFor('heat', heat).toLowerCase()}. This outweighs ingredient clues.`);
    if (c.texture.length) {
      if (c.texture.includes('crisp')) stated('crunch', c.texture.length > 1 ? .7 : .89, `Your textures: ${answerSummary('texture', answers).toLowerCase()}.`);
      else if (c.texture.some(id => ['silky', 'tender'].includes(id))) stated('crunch', .22, 'You selected soft textures without selecting crispness.');
      // Chewiness alone tells us nothing about the user's appetite for crunch.
    }
    const aroma = c.aromatics[0];
    if (aroma) stated('aromatic', aroma === 'subtle' ? .22 : .85, `On your fragrant detour, you chose ${labelFor('aromatics', aroma).toLowerCase()}.`);
    const observations = [];
    if (c.texture.includes('crisp') && c.texture.length > 1) observations.push('Texture contrast may be your sweet spot: a crisp edge with a softer center.');
    if (c.cooking.includes('grilled')) observations.push('You may enjoy char and smoke. These are saved as notes; the current menu engine has no smoke dimension.');
    if (c.reasons.includes('ritual')) observations.push('Food memories matter to you. We have not translated nostalgia into a sensory score.');
    if (c.avoids.length) observations.push('Ingredient dislikes guide demo Picks when the menu mentions them. Missing details do not prove absence; dietary and allergy controls remain separate safeguards.');
    return { engine: 'deterministic-v3.1', axes,
      exploration: ({ familiar: .15, bridge: .5, explore: .9 } as Record<string, number>)[c.curiosity[0]] ?? null, observations };
  },
};
/** Profile adapter; structured saved notes travel separately with recommendation requests. */
export function toTasteAnswers(answers: DetectiveAnswers, reading: TasteReading): TasteAnswers {
  return { favorites: answers.choices.anchors.map(id => labelFor('anchors', id)).join(', ') || 'Still discovering my favorite dishes',
    style: answers.choices.contrast[0] === 'rich' ? 'comfort' : answers.choices.contrast[0] === 'bright' ? 'fresh' : 'balanced',
    heat: (answers.choices.heat[0] as TasteAnswers['heat']) || 'medium',
    texture: (reading.axes.crunch.value ?? .5) > .66 ? 'crunchy' : (reading.axes.crunch.value ?? .5) < .34 ? 'soft' : 'both',
    exploration: reading.exploration ?? .5, dietary_restrictions: answers.dietary_restrictions, allergies: answers.allergies };
}
export function enrichProfile(profile: TasteProfile, reading: TasteReading): TasteProfile {
  // V2 requires categorical answers. Undo adapter defaults for unanswered dimensions.
  return { ...profile, axes: Object.fromEntries(axisNames.map(axis => [axis, reading.axes[axis].value])) as TasteAxes,
    exploration: reading.exploration ?? .5, source: 'guided_demo' };
}
export function previewProfile(reading: TasteReading): TasteProfile { return enrichProfile(initialTaste(), reading); }

export function questionFor(step: StepId, answers: DetectiveAnswers) {
  const favorites = answers.choices.anchors;
  const anchor = favorites.length ? labelFor('anchors', favorites[0]).toLowerCase() : 'a meal you love';
  const questions: Record<StepId, { title: string; note: string }> = {
    anchors: { title: 'Which dishes feel like your kind of delicious?', note: 'Think of favorites you return to, beyond what you’re craving today. Choose up to three.' },
    reasons: { title: `Let’s linger on ${anchor}. What keeps you coming back?`, note: 'The dish is only the beginning. Choose the details that actually make it yours.' },
    contrast: { title: 'Two lovely plates. Which would you return to more often?', note: 'Imagine both are made beautifully. Follow your instinct, or choose a little of both.' },
    heat: { title: 'Flavor and fire are different pleasures. Where is your happy place?', note: 'Loving curry or tacos doesn’t tell us your heat tolerance. You do.' },
    texture: { title: 'Now, the part you feel. What makes a bite satisfying?', note: 'Choose every texture you enjoy. Contrast is welcome.' },
    aromatics: { title: 'A fragrant detour: what should reach you before the first bite?', note: `Because you chose ${answers.choices.reasons.includes('fragrant') ? 'the aroma' : anchor}, let’s explore this a little further.` },
    ingredients: { title: 'Which little details make a dish yours?', note: 'Tap what you enjoy, then what you prefer less of. These are preferences, never allergy declarations.' },
    cooking: { title: answers.choices.texture.includes('crisp') ? 'You enjoy a little crunch. How else do you like the kitchen to work?' : 'Great ingredients, different possibilities. What draws you in?', note: 'Select the cooking styles you find yourself ordering again and again.' },
    curiosity: { title: 'When a menu surprises you, what happens next?', note: 'Your usual appetite for discovery. You can always want something different tonight.' },
    boundaries: { title: 'A good host remembers the essentials.', note: 'Your lasting dietary preferences and allergies stay separate from your flavor profile.' },
    review: { title: 'A few lovely clues. Does this feel like you?', note: 'Revisit any answer before saving. Open questions stay open; we never fill them with certainty.' },
  };
  return questions[step];
}
export function suggestedReasons(answers: DetectiveAnswers): string[] {
  const map: Record<string, string[]> = { tacos: ['crisp', 'bright'], ramen: ['depth', 'comfort'], curry: ['fragrant', 'comfort'], pasta: ['comfort', 'ritual'], salad: ['bright', 'crisp'], grill: ['depth', 'ritual'] };
  return [...new Set(answers.choices.anchors.flatMap(id => map[id]))];
}

export function responseTo(step: StepId, answers: DetectiveAnswers): string | null {
  const c = answers.choices;
  if (step === 'reasons' && c.anchors.length) return 'A lovely starting point. The name of the dish is one clue; the part you love is the interesting one.';
  if (step === 'contrast' && c.reasons.includes('comfort')) return 'Comfort caught your attention. Let’s see how it sits alongside a little freshness.';
  if (step === 'contrast' && c.reasons.includes('fragrant')) return 'You notice the aroma. I’ve made room for a fragrant detour in our conversation.';
  if (step === 'texture' && c.heat[0] === 'mild') return 'Flavor without the fire. Understood. Loving a bold dish doesn’t have to mean loving chili.';
  if (step === 'texture' && c.heat[0] === 'hot') return 'A little fire belongs at your table. Let’s give the textures just as much attention.';
  if (step === 'cooking' && c.avoids.length) return 'Your dislikes are worth remembering too. I’ll keep these as notes, separate from allergy and dietary restrictions.';
  if (step === 'curiosity' && c.cooking.includes('grilled')) return 'That smoky, golden edge has a place in your notes. Now for the pleasure of discovering something new.';
  return null;
}
