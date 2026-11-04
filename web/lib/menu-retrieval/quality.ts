import type { RestaurantMenu } from '../contracts';

export type MenuQuality = 'ready' | 'missing' | 'incomplete' | 'outdated' | 'unreliable';
export type QualityCheck = { id: string; label: string; result: 'pass' | 'fail' | 'not_applicable'; detail: string };
export type MenuAssessment = { status: MenuQuality; checks: QualityCheck[]; reasons: string[]; itemCount: number; categoryCount: number };
/** Future server-supplied evidence. None of these fields certifies allergy safety. */
export type MenuEvidence = {
  origin: 'demo_fixture' | 'external'; sourceVerified: boolean;
  complete: boolean | null; observedAt: string | null; extractionConfidence: number | null;
};
export type QualityPolicy = { maxAgeDays: number; minimumPriceCoverage: number; minimumExtractionConfidence: number | null };
export const qualityPolicy: QualityPolicy = {
  maxAgeDays: 30, minimumPriceCoverage: 1,
  // A real extraction threshold needs evaluation before activation. Unknown means blocked.
  minimumExtractionConfidence: null,
};
export function fixtureEvidence(menu: RestaurantMenu): MenuEvidence {
  return { origin: 'demo_fixture', sourceVerified: menu.source.kind === 'demo_fixture',
    complete: menu.source.completeness === 'complete_fixture', observedAt: menu.source.retrieved_at, extractionConfidence: null };
}
export function assessMenu(menu: RestaurantMenu, expectedId: string, evidence = fixtureEvidence(menu), policy = qualityPolicy, now = Date.now()): MenuAssessment {
  const items = menu.categories.flatMap(category => category.items);
  const checks: QualityCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, result: pass ? 'pass' : 'fail', detail });
  const identity = menu.restaurant.id === expectedId;
  add('identity', 'The selected branch', identity, identity ? `${menu.restaurant.name} · ${menu.restaurant.area}` : 'The returned menu belongs to a different branch.');
  const unique = new Set(items.map(item => item.id)).size === items.length && new Set(menu.categories.map(category => category.id)).size === menu.categories.length;
  const structure = unique && menu.categories.every(category => category.name.trim() && category.items.length > 0 && category.items.every(item => item.category_id === category.id && item.name.trim()));
  add('structure', 'Dishes & categories', structure, structure ? `${items.length} distinct dishes in ${menu.categories.length} categories.` : 'Duplicate, empty, or mismatched menu entries need review.');
  const complete = evidence.complete === true && items.length === menu.total_items && items.length === menu.restaurant.item_count && items.length > 0;
  add('completeness', 'Available menu coverage', complete, complete ? 'Every item declared by this sample is present.' : 'The source does not establish a complete menu.');
  const priced = items.filter(item => item.price.status === 'listed' && item.price.amount_minor !== null).length;
  const priceCoverage = items.length ? priced / items.length : 0;
  add('prices', 'Prices for budget checks', priceCoverage >= policy.minimumPriceCoverage, `${priced} of ${items.length} dishes have a listed price. Tax and tip are not included.`);
  const observed = evidence.observedAt === null ? null : Date.parse(evidence.observedAt);
  const dated = observed !== null && Number.isFinite(observed) && observed <= now + 5 * 60 * 1000;
  const stale = dated && now - observed! > policy.maxAgeDays * 86400000;
  if (evidence.origin === 'demo_fixture' && observed === null) checks.push({ id: 'freshness', label: 'Source freshness', result: 'not_applicable', detail: 'Undated fictional fixture. This is not a claim of a current restaurant menu.' });
  else add('freshness', 'Source freshness', dated && !stale, stale ? `The recorded source is older than the ${policy.maxAgeDays}-day demo review window.` : dated ? 'The recorded date falls within the configured review window.' : 'A trustworthy source date is missing.');
  const extractionSupported = evidence.origin === 'demo_fixture' || (policy.minimumExtractionConfidence !== null && Number.isFinite(evidence.extractionConfidence)
    && evidence.extractionConfidence !== null && evidence.extractionConfidence >= policy.minimumExtractionConfidence && evidence.extractionConfidence <= 1);
  add('source', 'Provenance', evidence.sourceVerified && extractionSupported, evidence.origin === 'demo_fixture'
    ? 'Curated demo data from FastAPI. No external retrieval or AI extraction.'
    : 'External data requires verified provenance and an evaluated extraction threshold.');
  const unreliable = !identity || !structure || !evidence.sourceVerified || !extractionSupported || (observed !== null && !dated) || (evidence.origin === 'external' && observed === null);
  const status: MenuQuality = unreliable ? 'unreliable' : !items.length ? 'missing' : stale ? 'outdated' : !complete || priceCoverage < policy.minimumPriceCoverage ? 'incomplete' : 'ready';
  return { status, checks, reasons: checks.filter(check => check.result === 'fail').map(check => check.detail), itemCount: items.length, categoryCount: menu.categories.length };
}
export const recoveryCopy: Record<Exclude<MenuQuality, 'ready'>, { title: string; description: string }> = {
  missing: { title: 'A menu worth waiting for.', description: 'There isn’t an available menu to open here. Bring a copy from the restaurant, or choose another table.' },
  incomplete: { title: 'A few pages are missing.', description: 'The available dishes or prices don’t establish a complete menu. We’ll keep your preferences while you find a better source.' },
  outdated: { title: 'Let’s find a fresher edition.', description: 'This source falls outside the configured freshness window. Prices and dishes may have changed.' },
  unreliable: { title: 'This menu needs a closer look.', description: 'We can’t establish enough reliable menu evidence to continue. We won’t turn uncertain information into confident picks.' },
};
