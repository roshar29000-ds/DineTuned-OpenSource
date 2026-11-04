'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIdentity } from '../IdentityProvider';
import { useDineTuned } from '../AppProvider';
import type { FeedbackValue } from '../../lib/memory/journal';
import { DiningJournal, emptyJournal, type Journal } from '../../lib/memory/journal';

type MemoryContext = { store: DiningJournal | null; data: Journal; error: string; connected: boolean };
const Context = createContext<MemoryContext>({ store: null, data: emptyJournal(), error: '', connected: false });
export function DiningMemoryProvider({ children, sessionOnly = false }: { children: ReactNode; sessionOnly?: boolean }) {
  const { state } = useIdentity();
  const local = useDineTuned(), localRef = useRef(local); localRef.current = local;
  const [view, setView] = useState<MemoryContext>({ store: null, data: emptyJournal(), error: '', connected: false });
  const owner = sessionOnly ? 'demo' : state.status === 'ready' ? state.userId : state.status === 'connecting' ? null : 'local';
  const repository = !sessionOnly && state.status === 'ready' ? state.repository : null;
  useEffect(() => {
    if (!owner) { setView({ store: null, data: emptyJournal(), error: '', connected: false }); return; }
    let alive = true;
    let previous: FeedbackValue[] = [];
    const target = sessionOnly ? window.sessionStorage : window.localStorage;
    const storage = { getItem: (key: string) => target.getItem(key), setItem: (key: string, value: string) => target.setItem(key, value) };
    const store = new DiningJournal(owner, storage, repository, () => {
      if (alive) {
        // Reconcile only existing browser mirrors, never import another account's
        // histories or change the recommendation input merely by opening Memory.
        for (const old of previous) {
          const current = store.data.feedback.find(item => item.value.id === old.id);
          if (!current) localRef.current.removeFeedback(old.feedback.id);
          else if (current.status === 'synced' && JSON.stringify(current.value.feedback) !== JSON.stringify(old.feedback)) localRef.current.correctFeedback(current.value.feedback);
        }
        previous = store.data.feedback.filter(item => item.status === 'synced').map(item => item.value);
        setView({ store, data: store.data, error: store.error, connected: !!repository });
      }
    });
    previous = store.data.feedback.filter(item => item.status === 'synced').map(item => item.value);
    setView({ store, data: store.data, error: store.error, connected: !!repository });
    // Reads only. Pending uploads always require a deliberate action/retry.
    void store.refresh();
    return () => { alive = false; store.dispose(); };
  }, [owner, repository, sessionOnly]);
  // A changed identity must not flash the previous owner's records before effects run.
  const visible = view.store?.owner === owner ? view : { store: null, data: emptyJournal(), error: '', connected: false };
  return <Context.Provider value={visible}>{children}</Context.Provider>;
}
export function useDiningMemory() { return useContext(Context); }
