'use client';
import { useEffect, useState } from 'react';
import { demoRestaurantSearch, type RestaurantMatch, type RestaurantSearchInput, type RestaurantSearchProvider } from './search';

type SearchState = { key: string; matches: RestaurantMatch[]; loading: boolean; error: string | null; locationApplied: boolean };
export function useRestaurantSearch(input: RestaurantSearchInput, provider: RestaurantSearchProvider = demoRestaurantSearch) {
  const key = JSON.stringify(input);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ key: '', matches: [], loading: true, error: null, locationApplied: false });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, matches: [], loading: true, error: null, locationApplied: false });
    // Debounce typing only; retrieval and menu transitions have no artificial waits.
    const timer = setTimeout(() => provider.search(JSON.parse(key), controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ key, ...result, loading: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, matches: [], locationApplied: false, loading: false,
        error: error instanceof Error ? error.message : 'Restaurant search is unavailable. Please try again.' });
    }), 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, attempt, provider]);
  return { ...(state.key === key ? state : { key, matches: [], loading: true, error: null, locationApplied: false }), retry: () => setAttempt(value => value + 1) };
}
