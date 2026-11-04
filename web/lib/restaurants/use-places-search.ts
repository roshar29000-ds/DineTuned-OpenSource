'use client';
import { useSyncExternalStore } from 'react';
import { emptyPlacesView, type PlacesQuery, type PlacesSearchClient } from './places';

const subscribeToNothing = () => () => {};
const emptyView = () => emptyPlacesView;
const key = (value: PlacesQuery) => JSON.stringify([value.query.trim().toLowerCase(), value.area.trim(), value.location]);

export function usePlacesSearch(client: PlacesSearchClient | null, clearSelection: () => void) {
  const view = useSyncExternalStore(client?.subscribe ?? subscribeToNothing, client?.getView ?? emptyView, emptyView);
  const edited = !!view.submitted && key(view.draft) !== key(view.submitted);
  function setDraft(patch: Partial<PlacesQuery>) { client?.setDraft(patch); }
  function submit() { if (!client) return; clearSelection(); client.submitDraft(); }
  function retry() { if (!client) return; clearSelection(); client.submitDraft(true); }
  function select(placeId: string) { if (!client) return; clearSelection(); client.selectResult(placeId); }
  function clear() { if (!client) return; clearSelection(); client.clearSearch(); }
  return { ...view, edited, setDraft, submit, retry, select, clear };
}
