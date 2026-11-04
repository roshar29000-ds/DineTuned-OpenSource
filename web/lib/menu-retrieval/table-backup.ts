import { decodeContract } from '../validation';
import type { MenuDiscoveryHandoff, MenuExtractionResult, RealPicksRequest, RealPicksResult } from '../contracts';

export type GuestTableBackup = {
  selection: MenuDiscoveryHandoff | null;
  extraction: MenuExtractionResult | null;
  request: RealPicksRequest | null;
  picks: RealPicksResult | null;
  updated_at: string | null;
};

export async function loadGuestTable(accessToken: () => Promise<string>, signal?: AbortSignal): Promise<GuestTableBackup> {
  const token = await accessToken();
  signal?.throwIfAborted();
  const response = await fetch('/api/dinetuned/real-picks/table', {
    cache: 'no-store', signal, headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Your private table backup is temporarily unavailable. No model request was made.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('The saved table response is invalid.');
  const row = data as Record<string, unknown>;
  return {
    selection: row.selection == null ? null : decodeContract<MenuDiscoveryHandoff>('MenuDiscoveryHandoff', row.selection),
    extraction: row.extraction == null ? null : decodeContract<MenuExtractionResult>('MenuExtractionResult', row.extraction),
    request: row.request == null ? null : decodeContract<RealPicksRequest>('RealPicksRequest', row.request),
    picks: row.picks == null ? null : decodeContract<RealPicksResult>('RealPicksResult', row.picks),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

export async function clearGuestTable(selectionToken: string, accessToken: () => Promise<string>): Promise<void> {
  const token = await accessToken();
  const response = await fetch('/api/dinetuned/real-picks/table/clear', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ selection_token: selectionToken }),
  });
  if (!response.ok) throw new Error('Your old table backup could not be cleared. The current browser selection has changed.');
}
