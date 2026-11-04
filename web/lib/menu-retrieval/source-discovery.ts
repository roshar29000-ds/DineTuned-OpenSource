import { ApiError } from '../api';
import { decodeContract } from '../validation';
import type { MenuDiscoveryHandoff, MenuSourceResult } from '../contracts';

export function publicSourceLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function discoverMenuSources(handoff: MenuDiscoveryHandoff, website: string, requestId: string,
  accessToken: () => Promise<string>, signal: AbortSignal): Promise<MenuSourceResult> {
  if (!handoff.source_discovery_token) throw new Error('This selection needs a fresh server verification before website discovery. No Google request was made.');
  const url = publicSourceLink(website.trim());
  if (!url) throw new Error('Enter a complete public HTTPS restaurant website URL without credentials.');
  const token = await accessToken(); signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch('/api/dinetuned/menu-sources/discover', { method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ request_id: requestId, restaurant: handoff.restaurant, selection_token: handoff.source_discovery_token, website_url: url }) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError('The source check could not connect. It was not retried automatically.', 503);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    throw new ApiError(typeof detail === 'string' ? detail : 'This menu source could not be checked. Your restaurant and Taste DNA are unchanged.', response.status);
  }
  const result = decodeContract<MenuSourceResult>('MenuSourceResult', data);
  if (result.request_id !== requestId || result.restaurant_id !== handoff.restaurant.place_id
    || result.candidates.some(c => !publicSourceLink(c.source_url) || !publicSourceLink(c.discovered_from) || c.evidence.some(e => !publicSourceLink(e.source_url)))
    || result.recommended_candidate_id && !result.candidates.some(c => c.id === result.recommended_candidate_id && c.suitable_for_extraction)) {
    throw new Error('The source response did not match this restaurant or check. No menu was substituted.');
  }
  return result;
}
