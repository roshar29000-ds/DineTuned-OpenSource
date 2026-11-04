import type { MenuDiscoveryHandoff, MenuExtractionResult, RealPicksResult } from '../contracts';
import type { GuestTableBackup } from './table-backup';

// This is a tab-lifetime view cache, not proof of identity or menu authenticity.
// FastAPI verifies every signed snapshot and the current guest before accepting work.
function signedExpiry(token: string | null | undefined): number {
  if (!token) return 0;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return 0;
    const encoded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
    if (!claims || typeof claims !== 'object' || !('expires' in claims)) return 0;
    const expires = claims.expires;
    return Number.isSafeInteger(expires) && typeof expires === 'number' ? expires * 1000 : 0;
  } catch { return 0; }
}

export function signedTokenCurrent(token: string | null | undefined, graceMs = 0): boolean {
  return signedExpiry(token) + graceMs > Date.now();
}

// Legacy/offline opaque fixtures still reach the server, which remains the
// authority. A recognizable expired token is blocked before that request.
export function signedTokenExpired(token: string | null | undefined, graceMs = 0): boolean {
  const expiry = signedExpiry(token);
  return expiry > 0 && expiry + graceMs <= Date.now();
}

function displayKey(key: string): string {
  // Expiry removes only the signed recommendation token from a browsable menu.
  // The read-only result must still match every other menu and preference field.
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object'
        && 'extraction' in value[0] && value[0].extraction && typeof value[0].extraction === 'object') {
      const extraction = value[0].extraction as Record<string, unknown>;
      delete extraction.recommendation_token;
      const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => [name, ordered(child)])) : item;
      return JSON.stringify(ordered(value));
    }
  } catch { /* Legacy opaque keys stay exact-match only. */ }
  return key;
}

/** Keeps one guest's selected table across client-side route changes. Never writes
 * Google content, signed proofs, menu text, or private Picks to browser storage. */
export class RealTableSession {
  private selection: MenuDiscoveryHandoff | null = null;
  private extraction: MenuExtractionResult | null = null;
  private picks: { key: string; result: RealPicksResult } | null = null;
  private revision = 0;

  getRevision() { return this.revision; }

  restore(snapshot: GuestTableBackup, owner: string, expectedRevision = this.revision): boolean {
    if (expectedRevision !== this.revision || !snapshot.selection) return false;
    const selection = snapshot.selection, extraction = snapshot.extraction;
    if (extraction && (extraction.restaurant_id !== selection.restaurant.place_id
        || extraction.menu.restaurant_id !== selection.restaurant.place_id)) return false;
    const request = snapshot.request, result = snapshot.picks;
    if ((request || result) && (!extraction || !request || !result
        || request.extraction.menu.version !== extraction.menu.version
        || result.request_id !== request.request_id || result.restaurant_id !== extraction.restaurant_id
        || result.menu_version !== extraction.menu.version)) return false;
    this.selection = selection; this.extraction = extraction;
    if (request && result) {
      const { request_id: _requestId, ...input } = request;
      this.picks = { key: JSON.stringify([input, owner]), result };
    } else this.picks = null;
    this.revision++;
    return true;
  }

  setSelection(next: MenuDiscoveryHandoff) {
    if (this.selection?.restaurant.place_id === next.restaurant.place_id
        && this.selection.source_discovery_token === next.source_discovery_token) return;
    this.selection = next;
    this.extraction = null;
    this.picks = null;
    this.revision++;
  }

  getSelection(): MenuDiscoveryHandoff | null { return this.selection; }

  clear() { this.selection = null; this.extraction = null; this.picks = null; this.revision++; }

  clearExtraction() { this.extraction = null; this.picks = null; this.revision++; }

  setExtraction(handoff: MenuDiscoveryHandoff, result: MenuExtractionResult) {
    if (!this.sameSelection(handoff) || result.restaurant_id !== handoff.restaurant.place_id
        || result.menu.restaurant_id !== handoff.restaurant.place_id) return;
    this.extraction = result;
    this.picks = null;
    this.revision++;
  }

  getExtraction(handoff: MenuDiscoveryHandoff): MenuExtractionResult | null {
    if (!this.sameSelection(handoff) || !this.extraction) return null;
    // The full parsed menu remains browsable, but an expired signed snapshot
    // cannot initiate another recommendation or resurrect an earlier result.
    return signedTokenCurrent(this.extraction.recommendation_token)
      ? this.extraction : { ...this.extraction, recommendation_token: null };
  }

  /** Original snapshot for read-only session display. Signed expiry is still
   * checked before any new recommendation request reaches FastAPI. */
  getExtractionForView(handoff: MenuDiscoveryHandoff): MenuExtractionResult | null {
    return this.sameSelection(handoff) ? this.extraction : null;
  }

  setPicks(key: string, result: RealPicksResult) {
    if (!this.extraction || !signedTokenCurrent(this.extraction.recommendation_token)
        || result.restaurant_id !== this.extraction.menu.restaurant_id
        || result.menu_version !== this.extraction.menu.version) return;
    this.picks = { key, result };
    this.revision++;
  }

  getPicks(key: string): RealPicksResult | null {
    return this.extraction && this.picks && displayKey(this.picks.key) === displayKey(key)
      && this.picks.result.restaurant_id === this.extraction.menu.restaurant_id
      && this.picks.result.menu_version === this.extraction.menu.version ? this.picks.result : null;
  }

  /** Previously validated, guest-owned Picks remain viewable when temporary
   * preferences change. They are never treated as a current recommendation. */
  getSavedPicksForView(owner: string): RealPicksResult | null {
    if (!this.extraction || !this.picks || this.picks.result.restaurant_id !== this.extraction.menu.restaurant_id
        || this.picks.result.menu_version !== this.extraction.menu.version) return null;
    try {
      const key: unknown = JSON.parse(this.picks.key);
      if (!Array.isArray(key) || key.length !== 2 || key[1] !== owner) return null;
      return this.picks.result;
    } catch { return null; }
  }

  private sameSelection(handoff: MenuDiscoveryHandoff): boolean {
    return !!this.selection && this.selection.restaurant.place_id === handoff.restaurant.place_id
      && this.selection.source_discovery_token === handoff.source_discovery_token;
  }
}
