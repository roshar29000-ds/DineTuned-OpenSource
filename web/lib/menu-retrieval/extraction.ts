/** Explicit backend extraction boundary. It does not activate demo recommendation APIs. */
import { ApiError } from '../api';
import { decodeContract } from '../validation';
import type { MenuDiscoveryHandoff, MenuSourceResult, MenuExtractionResult } from '../contracts';
import { publicSourceLink } from './source-discovery';

export async function extractMenuSources(handoff: MenuDiscoveryHandoff, sources: MenuSourceResult, requestId: string,
  accessToken: () => Promise<string>, signal: AbortSignal, candidateIds: string[] = []): Promise<MenuExtractionResult> {
  if (!handoff.source_discovery_token || !sources.extraction_token || sources.restaurant_id !== handoff.restaurant.place_id) {
    throw new Error('A current, verified branch and source check are required before extraction.');
  }
  const eligible = sources.candidates.filter(candidate => candidate.suitable_for_extraction && candidate.access === 'checked'
    && candidate.branch_relevance === 'exact' && candidate.freshness !== 'outdated' && ['dine_in', 'unknown'].includes(candidate.menu_type));
  if (candidateIds.length > 8 || new Set(candidateIds).size !== candidateIds.length
      || candidateIds.some(id => !eligible.some(candidate => candidate.id === id))) {
    throw new Error('Choose distinct, eligible sources from this menu check.');
  }
  const requested = eligible.filter(candidate => !candidateIds.length || candidateIds.includes(candidate.id)).slice(0, 8);
  if (!requested.length) throw new Error('No verified menu sources are available to extract.');
  const token = await accessToken(); signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch('/api/dinetuned/menu-extraction/extract', { method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ request_id: requestId, restaurant: handoff.restaurant, selection_token: handoff.source_discovery_token,
        sources, candidate_ids: candidateIds }) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError('Menu extraction could not connect. No automatic retry was made.', 503);
  }
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    throw new ApiError(typeof detail === 'string' ? detail : 'Menu extraction could not be confirmed.', response.status);
  }
  const result = decodeContract<MenuExtractionResult>('MenuExtractionResult', data);
  const menu = result.menu, items = menu.categories.flatMap(category => category.items);
  const evidence = new Map(menu.evidence.map(entry => [entry.id, entry]));
  const documents = new Map(menu.sources.map(source => [source.id, source]));
  const approved = new Map(requested.map(candidate => [candidate.id, candidate]));
  if (result.request_id !== requestId || result.restaurant_id !== handoff.restaurant.place_id
      || menu.restaurant_id !== handoff.restaurant.place_id || menu.restaurant.place_id !== handoff.restaurant.place_id
      || menu.restaurant.source.place_id !== handoff.restaurant.place_id
      || menu.restaurant.display_name !== handoff.restaurant.display_name || menu.restaurant.formatted_address !== handoff.restaurant.formatted_address
      || menu.total_items !== items.length || new Set(items.map(item => item.id)).size !== items.length
      || new Set(menu.categories.map(category => category.id)).size !== menu.categories.length
      || documents.size !== menu.sources.length || evidence.size !== menu.evidence.length
      || menu.sources.length !== approved.size || new Set(menu.sources.map(source => source.candidate.id)).size !== approved.size
      || (result.status === 'unavailable') !== (items.length === 0)
      || menu.sources.some(source => !approved.has(source.candidate.id)
        || approved.get(source.candidate.id)?.source_url !== source.candidate.source_url
        || approved.get(source.candidate.id)?.format !== source.candidate.format
        || !publicSourceLink(source.source_url))
      || menu.evidence.some(entry => !publicSourceLink(entry.source_url) || documents.get(entry.source_id)?.source_hash !== entry.source_hash
        || documents.get(entry.source_id)?.source_url !== entry.source_url)
      || menu.categories.some(category => category.evidence_ids.some(id => !evidence.has(id))
        || category.items.some(item => item.category_id !== category.id || !item.evidence_ids.length
          || item.evidence_ids.some(id => !evidence.has(id)) || item.price.options.some(price => !item.evidence_ids.includes(price.evidence_id))))) {
    throw new Error('The extracted menu did not match this branch, source evidence or request. No substitute menu was used.');
  }
  return result;
}
