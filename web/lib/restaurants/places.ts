import { ApiError } from '../api';
import { decodeContract } from '../validation';
import type { DiscoveryResults, DiscoverySession, MenuDiscoveryHandoff } from '../contracts';
import type { SearchLocation } from './search';

export type PlacesQuery = { query: string; area: string; location: SearchLocation | null };
export type PlacesSearchView = {
  draft: PlacesQuery; submitted: PlacesQuery | null; data: DiscoveryResults | null;
  loading: boolean; error: string | null; selecting: boolean;
  selected: MenuDiscoveryHandoff | null; selectionError: string | null;
};
export const emptyPlacesView: PlacesSearchView = {
  draft: { query: '', area: '', location: null }, submitted: null, data: null,
  loading: false, error: null, selecting: false, selected: null, selectionError: null,
};
const queryKey = (input: PlacesQuery) => JSON.stringify([input.query.trim().toLowerCase(), input.area.trim(), input.location]);

/** Ephemeral search state only: never persist Google names, addresses or coordinates. */
export class PlacesSearchClient {
  private session: Promise<DiscoverySession> | null = null;
  private generation = 0;
  private disposed = false;
  private consumed = false;
  private expired = false;
  private context: string | null = null;
  private lastQuery: string | null = null;
  private predictions = new Map<string, Promise<DiscoveryResults>>();
  // Keep consumed-token tombstones even on explicit reset: one Details attempt per token.
  private selections = new Map<string, { placeId: string; pending: Promise<MenuDiscoveryHandoff> | null }>();
  private requests = new Set<AbortController>();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private view: PlacesSearchView = emptyPlacesView;
  private listeners = new Set<() => void>();
  private viewRevision = 0;
  constructor(private readonly accessToken: () => Promise<string>) {}
  getView = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<PlacesSearchView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  setDraft(patch: Partial<PlacesQuery>) {
    const next = { ...this.view.draft, ...patch };
    if (queryKey(next) !== queryKey(this.view.draft) || next.query !== this.view.draft.query || next.area !== this.view.draft.area) {
      this.publish({ draft: next });
    }
  }
  /** Only a button or Enter invokes this method. The submitted context and its
   * validated response live with the guest-owned client across remounts. */
  submitDraft(force = false) {
    const input = { ...this.view.draft, query: this.view.draft.query.trim(), area: this.view.draft.area.trim() };
    if (input.query.length < 3 || this.view.selecting) return;
    const needsFreshSession = !!this.view.selectionError || !!this.view.error || this.expired || this.consumed;
    if (this.view.submitted && queryKey(input) === queryKey(this.view.submitted)
        && (this.view.loading || (!force && !needsFreshSession))) return;
    this.viewRevision++;
    const revision = this.viewRevision;
    this.resetSession();
    this.publish({ submitted: input, data: null, error: null, loading: true, selected: null, selectionError: null });
    const controller = new AbortController();
    void this.search(input, controller.signal).then(data => {
      if (!this.disposed && revision === this.viewRevision) this.publish({ data, loading: false });
    }).catch(error => {
      if (!this.disposed && revision === this.viewRevision) this.publish({ error: error instanceof Error ? error.message : 'Restaurant search is unavailable.', loading: false });
    });
  }
  selectResult(placeId: string) {
    const data = this.view.data;
    if (!data || this.view.selecting || this.view.selected || !data.predictions.some(p => p.place_id === placeId)) return;
    const revision = this.viewRevision;
    this.publish({ selecting: true, selectionError: null });
    void this.select(placeId, data.session_token, new AbortController().signal).then(selected => {
      if (!this.disposed && revision === this.viewRevision) this.publish({ selected, selecting: false });
    }).catch(error => {
      if (!this.disposed && revision === this.viewRevision) this.publish({ selectionError: error instanceof Error ? error.message : 'This branch could not be confirmed.', selecting: false });
    });
  }
  clearSearch() {
    this.viewRevision++;
    this.reset();
    this.publish(emptyPlacesView);
  }
  private resetSession() {
    this.generation++; this.session = null; this.consumed = false; this.expired = false;
    clearTimeout(this.expiryTimer);
    this.predictions.clear();
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
  reset() { this.resetSession(); }
  dispose() { this.reset(); this.disposed = true; this.selections.clear(); this.listeners.clear(); }
  private assertActive() {
    if (this.disposed) throw new Error('Your cloud session changed. Start again with your verified identity.');
  }
  private ended() { return new ApiError('This search session ended. Start a new search.', 409); }

  /** Track the submitted context without issuing any request. Repeated mounts
   * leave the session intact, including consumed sessions. */
  updateInput(input: PlacesQuery) {
    if (input.query.trim().length < 3) return;
    const context = JSON.stringify([input.area.trim(), input.location]);
    const key = JSON.stringify([input.query.trim().toLowerCase(), context]);
    if (this.context !== null && context !== this.context
        || this.consumed && !this.expired && this.lastQuery !== key) this.resetSession();
    this.context = context; this.lastQuery = key;
  }

  /** Aborting a UI subscriber must not cause another copy of an issued request.
   * Shared transport is bounded, and cancelled on context/identity reset. */
  private observe<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      pending.then(value => { if (!signal.aborted) resolve(value); }, reject)
        .finally(() => signal.removeEventListener('abort', aborted));
    });
  }

  private async request<T>(path: string, contract: string, body: unknown): Promise<T> {
    this.assertActive();
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const token = await this.accessToken();
      this.assertActive(); controller.signal.throwIfAborted();
      const response = await fetch('/api/dinetuned/discovery/' + path, { method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      const data: unknown = await response.json().catch(() => null);
      controller.signal.throwIfAborted(); this.assertActive();
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
        throw new ApiError(typeof detail === 'string' ? detail : 'Restaurant search could not complete. Start a new search.', response.status);
      }
      return decodeContract<T>(contract, data);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Restaurant search could not complete. No request was retried automatically. Start a new search.', 503);
    } finally {
      clearTimeout(timeout); this.requests.delete(controller);
    }
  }

  async search(input: PlacesQuery, signal: AbortSignal): Promise<DiscoveryResults> {
    this.assertActive(); signal.throwIfAborted();
    if (input.query.trim().length < 3) throw new Error('Enter at least 3 characters.');
    const normalized = { ...input, query: input.query.trim(), area: input.area.trim() };
    this.updateInput(normalized);
    const key = this.lastQuery!;
    if (this.expired || this.consumed) throw this.ended(); // Never renew automatically on remount/focus.
    const generation = this.generation;
    let pending = this.predictions.get(key);
    if (!pending) {
      pending = this.searchOnce(normalized, generation);
      this.predictions.set(key, pending); // Includes errors: only an explicit restart retries.
    }
    const result = await this.observe(pending, signal);
    if (generation !== this.generation || this.consumed || this.expired) throw this.ended();
    return result;
  }

  private async searchOnce(input: PlacesQuery, generation: number): Promise<DiscoveryResults> {
    // Keep a failed creation promise too; auth events must never retry it.
    const session = await (this.session ||= this.request<DiscoverySession>('sessions', 'DiscoverySession', {}).then(value => {
      if (generation !== this.generation) throw this.ended();
      const lifetime = Math.min(300000, Date.parse(value.expires_at) - Date.now());
      if (lifetime <= 0) { this.expired = true; throw this.ended(); }
      this.expiryTimer = setTimeout(() => {
        this.expired = true; this.predictions.clear();
        if (this.view.submitted && queryKey(this.view.submitted) === queryKey(input) && !this.view.selected) {
          this.publish({ error: 'This search session expired. Search again to request current branches.' });
        }
      }, lifetime);
      this.expiryTimer.unref?.();
      return value;
    }));
    if (generation !== this.generation || this.expired) throw this.ended();
    const response = await this.request<DiscoveryResults>('autocomplete', 'DiscoveryResults', { ...input, session_token: session.session_token });
    if (response.provider !== 'google_places' || response.session_token !== session.session_token || response.predictions.some(p => p.provider !== 'google_places')) {
      throw new Error('Restaurant search returned an inconsistent identity. Start a new search.');
    }
    return response;
  }

  async select(placeId: string, sessionToken: string, signal: AbortSignal): Promise<MenuDiscoveryHandoff> {
    this.assertActive(); signal.throwIfAborted();
    const previous = this.selections.get(sessionToken);
    if (previous) {
      if (previous.placeId === placeId && previous.pending) return this.observe(previous.pending, signal);
      throw this.ended();
    }
    if (!this.session || this.expired || this.consumed) throw this.ended();
    this.consumed = true; // Synchronous guard before awaiting; even failed Details consumes it.
    const generation = this.generation;
    const attempt = { placeId, pending: null as Promise<MenuDiscoveryHandoff> | null };
    this.selections.set(sessionToken, attempt);
    attempt.pending = (async () => {
      const session = await this.session;
      if (!session || session.session_token !== sessionToken || generation !== this.generation) throw this.ended();
      const response = await this.request<MenuDiscoveryHandoff>('selection', 'MenuDiscoveryHandoff', { place_id: placeId, session_token: sessionToken });
      if (generation !== this.generation) throw this.ended();
      const r = response.restaurant;
      if (r.provider !== 'google_places' || r.place_id !== placeId || r.source.place_id !== placeId || r.source.provider !== r.provider || r.source.api !== 'places_new') {
        throw new Error('The returned branch did not match your selection. Start a new search.');
      }
      return response;
    })().finally(() => { attempt.pending = null; });
    return this.observe(attempt.pending, signal);
  }

}

export function placeCategory(types: string[]) {
  const type = types.find(t => t.endsWith('_restaurant')) || types.find(t => ['restaurant', 'cafe', 'bakery', 'bar', 'coffee_shop'].includes(t));
  return type ? type.replaceAll('_', ' ') : 'Category unavailable';
}
