'use client';
import { useEffect, useState } from 'react';
import { apiRequest } from './api';

export function useApi<T>(path: string | null, contract: string, body?: unknown, delay = 0) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const signature = path + ':' + (payload || '');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ signature: string; data: T | null; error: Error | null; loading: boolean }>({
    signature: '', data: null, error: null, loading: true,
  });
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState({ signature, data: null, error: null, loading: true });
    const timer = setTimeout(() => {
      apiRequest<T>(path, contract, payload === undefined ? undefined : JSON.parse(payload), controller.signal)
        .then(data => { if (!controller.signal.aborted) setState({ signature, data, error: null, loading: false }); })
        .catch(error => { if (!controller.signal.aborted) setState({ signature, data: null, error, loading: false }); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [path, contract, payload, signature, delay, attempt]);
  const current = state.signature === signature;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: path !== null && (!current || state.loading),
    retry: () => setAttempt(value => value + 1),
  };
}
