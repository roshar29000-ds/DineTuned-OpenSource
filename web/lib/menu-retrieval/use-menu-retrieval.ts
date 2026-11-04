'use client';
import { useEffect, useState } from 'react';
import { demoMenuProvider, type MenuRetrievalProvider, type MenuRetrievalResult, type RetrievalProgress } from './provider';

type State = { id: string; progress: RetrievalProgress; result: MenuRetrievalResult | null; error: Error | null; loading: boolean };
const pending = (id: string): State => ({ id, progress: { stage: 'finding', menu: null }, result: null, error: null, loading: true });
export function useMenuRetrieval(id: string, provider: MenuRetrievalProvider = demoMenuProvider) {
  const [state, setState] = useState<State>(() => pending(id));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(pending(id));
    provider.retrieve(id, controller.signal, progress => {
      if (!controller.signal.aborted) setState({ ...pending(id), progress });
    }).then(result => {
      if (!controller.signal.aborted) setState({ id, progress: { stage: 'checking', menu: result.menu }, result, error: null, loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ ...pending(id), loading: false, error: error instanceof Error ? error : new Error('Menu retrieval is unavailable.') });
    });
    return () => controller.abort();
  }, [id, attempt, provider]);
  return { ...(state.id === id ? state : pending(id)), retry: () => { setState(pending(id)); setAttempt(value => value + 1); } };
}
