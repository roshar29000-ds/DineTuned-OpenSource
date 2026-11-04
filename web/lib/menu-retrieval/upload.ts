/** User-supplied document boundary. No file is persisted or sent to an outside menu service. */
import { ApiError } from '../api';
import { decodeContract } from '../validation';
import type { MenuDiscoveryHandoff, MenuExtractionResult } from '../contracts';

export const MAX_MENU_UPLOAD_BYTES = 3_000_000;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export async function uploadMenuDocument(handoff: MenuDiscoveryHandoff, file: File, requestId: string,
  accessToken: () => Promise<string>, signal: AbortSignal): Promise<MenuExtractionResult> {
  if (!handoff.source_discovery_token) throw new Error('A verified restaurant branch is required before uploading a menu.');
  if (!file.size || file.size > MAX_MENU_UPLOAD_BYTES) throw new Error('Choose a menu file up to 3 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const token = await accessToken();
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch('/api/dinetuned/menu-extraction/upload', { method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ request_id: requestId, restaurant: handoff.restaurant,
        selection_token: handoff.source_discovery_token, filename: file.name, content_base64: base64(bytes) }) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError('Menu upload could not connect. No automatic retry was made.', 503);
  }
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    throw new ApiError(typeof detail === 'string' ? detail : 'This menu could not be extracted.', response.status);
  }
  const result = decodeContract<MenuExtractionResult>('MenuExtractionResult', data);
  const menu = result.menu, source = menu.sources[0];
  const items = menu.categories.flatMap(category => category.items);
  const evidence = new Map(menu.evidence.map(entry => [entry.id, entry]));
  const expectedUrl = `urn:dinetuned:upload:${digest}`;
  if (result.request_id !== requestId || result.restaurant_id !== handoff.restaurant.place_id
      || menu.restaurant_id !== handoff.restaurant.place_id || menu.restaurant.place_id !== handoff.restaurant.place_id
      || menu.restaurant.source.place_id !== handoff.restaurant.place_id
      || menu.restaurant.display_name !== handoff.restaurant.display_name || menu.restaurant.formatted_address !== handoff.restaurant.formatted_address
      || menu.sources.length !== 1 || !source || source.source_hash !== digest || source.source_url !== expectedUrl
      || source.candidate.provenance !== 'user_upload' || source.candidate.branch_relevance !== 'unknown'
      || result.requests_made !== 0 || menu.total_items !== items.length || new Set(items.map(item => item.id)).size !== items.length
      || new Set(menu.categories.map(category => category.id)).size !== menu.categories.length
      || evidence.size !== menu.evidence.length || (result.status === 'unavailable') !== (items.length === 0)
      || menu.evidence.some(entry => entry.source_id !== source.id || entry.source_hash !== digest || entry.source_url !== expectedUrl)
      || menu.categories.some(category => category.evidence_ids.some(id => !evidence.has(id))
        || category.items.some(item => item.category_id !== category.id || !item.evidence_ids.length
          || item.evidence_ids.some(id => !evidence.has(id)) || item.price.options.some(price => !item.evidence_ids.includes(price.evidence_id))))) {
    throw new Error('The uploaded menu response did not match this file or selected branch. No substitute menu was used.');
  }
  return result;
}
