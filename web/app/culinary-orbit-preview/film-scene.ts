import type { OrbitScene } from '../../components/menu-retrieval/MuseLoading';

/**
 * Film-only scene for the local preview route. No request is made and no Picks are named.
 * Dishes, categories, descriptions and prices match the film's transcribed Girl & The Goat menu (dinetuned-film/src/discovery/data.ts).
 */
export const filmScene: OrbitScene = {
  restaurant: 'Girl & The Goat', dishCount: 23, mode: 'meta', film: true,
  dishes: [
    { name: 'chickpea fritters', category: 'VEGGIES', price: '$20', note: 'goat yogurt . green chutney . sev spice crunch' },
    { name: 'hamachi agua chile', category: 'FISH', price: '$26', note: 'apple . shiso . sesame' },
    { name: 'wood fired chicken thigh', category: 'MEAT', price: '$30', note: 'woodfired cabbage . miso baba ganoush . almond crunch' },
    { name: 'pita & dips', category: 'BREAD', price: '$16', note: 'carrot-tahini dip . tahini tofu hummus' },
    { name: 'sautéed green beans', category: 'VEGGIES', price: '$20', note: 'fish sauce vinaigrette . cashews' },
    { name: 'shrimp salad', category: 'FISH', price: '$26', note: 'avocado . quinoa crunch . pickled veggies . limey-herby dressing' },
    { name: 'roasted beets', category: 'VEGGIES', price: '$20', note: 'golden beet giardiniera . yuzu kosho . party nuts' },
    { name: 'ginger chili yum salmon', category: 'FISH', price: '$37', note: 'celery & peanut salad . sticky soy glaze' },
  ],
};
