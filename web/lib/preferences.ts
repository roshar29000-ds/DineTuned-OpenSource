import type { AllergyProfile, Allergen, DietaryRestriction, DiningConstraints, TasteAxes, TasteProfile } from './contracts';

export type Axis = keyof TasteAxes;
export const axisNames: Axis[] = ['spice', 'richness', 'freshness', 'crunch', 'aromatic', 'sweetness', 'umami'];
export const axisLabels: Record<Axis, string> = {
  spice: 'Heat', richness: 'Richness', freshness: 'Freshness', crunch: 'Crunch',
  aromatic: 'Aromatics', sweetness: 'Sweetness', umami: 'Savoriness',
};
export const diets: { value: DietaryRestriction; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarian' }, { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' }, { value: 'no_beef', label: 'No beef' },
  { value: 'no_pork', label: 'No pork' }, { value: 'dairy_free', label: 'Dairy-free' },
  { value: 'gluten_free', label: 'Gluten-free' },
];
export const allergens: { value: Allergen; label: string }[] = [
  { value: 'milk', label: 'Milk' }, { value: 'egg', label: 'Egg' },
  { value: 'fish', label: 'Fish' }, { value: 'shellfish', label: 'Shellfish' },
  { value: 'tree_nut', label: 'Tree nuts' }, { value: 'peanut', label: 'Peanuts' },
  { value: 'wheat', label: 'Wheat' }, { value: 'soy', label: 'Soy' },
  { value: 'sesame', label: 'Sesame' },
];
export function emptyAllergies(): AllergyProfile { return { allergens: [], other: '' }; }
export function initialTaste(): TasteProfile {
  return { schema_version: 2, complete: false, favorites: '', axes: { spice: null, richness: null, freshness: null, crunch: null, aromatic: null, sweetness: null, umami: null },
    exploration: .5, dietary_restrictions: [], allergies: emptyAllergies(), updated_at: null, source: 'guided_demo' };
}
export function initialConstraints(): DiningConstraints {
  return { max_price_minor: 3000, currency: 'USD', dietary_restrictions: [], allergies: emptyAllergies(), mood: 'open', appetite: 'any' };
}
export function money(amount: number | null, currency = 'USD') {
  return amount === null ? 'Price unavailable' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: amount % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount / 100);
}
export const hasAllergies = (allergies: AllergyProfile) => allergies.allergens.length > 0 || !!allergies.other.trim();
