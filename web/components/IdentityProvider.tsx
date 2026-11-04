'use client';
import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { identityRuntime } from '../lib/identity/client';
import { IdentityAccess } from '../lib/identity/access';
import { CloudMemoryRepository, type MemoryRepository } from '../lib/memory-repository';
import { PlacesSearchClient } from '../lib/restaurants/places';
import { RealTableSession } from '../lib/menu-retrieval/real-session';
import { loadGuestTable } from '../lib/menu-retrieval/table-backup';

type ReadyIdentity = { status: 'ready'; userId: string; anonymous: boolean; repository: MemoryRepository;
  getAccessToken: () => Promise<string>; access: IdentityAccess; places: PlacesSearchClient; table: RealTableSession;
  tableLoading: boolean; tableWarning?: string };
type IdentityState = { status: 'connecting' } | { status: 'local' } | { status: 'error'; message: string }
  | ReadyIdentity;
const Context = createContext<{ state: IdentityState; retry: () => void } | null>(null);

export function IdentityProvider({ children, localOnly = false }: { children: ReactNode; localOnly?: boolean }) {
  const [state, setState] = useState<IdentityState>(localOnly ? { status: 'local' } : { status: 'connecting' });
  const [attempt, setAttempt] = useState(0);
  const ready = useRef<ReadyIdentity | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (localOnly) { setState({ status: 'local' }); return; }
    let alive = true, revision = 0;
    let unsubscribe: (() => void) | undefined;
    let verificationTimer: ReturnType<typeof setTimeout> | undefined;
    let tableController: AbortController | undefined;
    const invalidate = () => {
      revision++;
      clearTimeout(verificationTimer);
      tableController?.abort();
      ready.current?.access.revoke();
      ready.current?.places.dispose();
      ready.current?.table.clear();
      ready.current = null;
    };
    setState({ status: 'connecting' });
    (async () => {
      const runtime = await identityRuntime();
      if (!alive) return;
      if (!runtime) { setState({ status: 'local' }); return; }
      const verify = async (expectedUserId?: string) => {
        const current = ++revision;
        try {
          const identity = await runtime.initialize();
          if (!alive || current !== revision) return;
          if (expectedUserId && identity.id !== expectedUserId) throw new Error('Your cloud session changed. Local records are unchanged.');
          if (ready.current?.userId !== identity.id) {
            invalidate();
            const access = new IdentityAccess(runtime.client.auth, identity.id);
            const table = new RealTableSession();
            ready.current = { status: 'ready', userId: identity.id, anonymous: identity.isAnonymous, access,
              repository: new CloudMemoryRepository(access.credentials), getAccessToken: access.getAccessToken,
              places: new PlacesSearchClient(access.getAccessToken), table, tableLoading: true };
            const expectedRevision = table.getRevision();
            const controller = new AbortController(); tableController = controller;
            void loadGuestTable(access.getAccessToken, controller.signal).then(snapshot => {
              if (!alive || controller.signal.aborted || ready.current?.table !== table) return;
              table.restore(snapshot, identity.id, expectedRevision);
              ready.current = { ...ready.current, tableLoading: false };
              setState(ready.current);
            }).catch(() => {
              if (!alive || controller.signal.aborted || ready.current?.table !== table) return;
              ready.current = { ...ready.current, tableLoading: false,
                tableWarning: 'Your saved restaurant table could not be restored. No model request was made.' };
              setState(ready.current);
            });
          } else if (ready.current.anonymous !== identity.isAnonymous) {
            ready.current = { ...ready.current, anonymous: identity.isAnonymous };
          }
          setState(ready.current);
        } catch (error) {
          if (alive && current === revision) {
            invalidate();
            setState({ status: 'error', message: error instanceof Error ? error.message : 'Cloud identity is unavailable. Local records are unchanged.' });
          }
        }
      };
      await verify();
      if (!alive) return;
      const { data } = runtime.client.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        if (event === 'SIGNED_OUT' || !session && (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)
            || event === 'INITIAL_SESSION' && ready.current !== null)) {
          invalidate();
          setState({ status: 'error', message: 'Your cloud session ended. Local Taste DNA remains available; no replacement identity was created.' });
        } else if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)
            || event === 'INITIAL_SESSION' && session?.user.id !== ready.current?.userId) {
          // Repeated SIGNED_IN (including tab visibility) is not a new identity.
          // Retain services while re-verifying; every API call still reads the fresh
          // token and the backend independently validates it with Supabase Auth.
          if (!session || ready.current?.userId !== session.user.id) {
            invalidate();
            setState({ status: 'connecting' });
          }
          clearTimeout(verificationTimer);
          const eventRevision = revision;
          // Do not await Auth methods inside its callback/refresh lock.
          verificationTimer = setTimeout(() => {
            if (alive && revision === eventRevision) void verify(session?.user.id);
          }, 0);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    })().catch(() => { if (alive) setState({ status: 'error', message: 'Cloud connection is unavailable. Your browser records remain local.' }); });
    return () => { alive = false; invalidate(); unsubscribe?.(); };
  }, [attempt, localOnly]);
  return <Context.Provider value={{ state, retry }}>{children}</Context.Provider>;
}

export function useIdentity() {
  const value = useContext(Context);
  if (!value) throw new Error('IdentityProvider is missing');
  return value;
}
