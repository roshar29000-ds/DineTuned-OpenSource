'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DiningConstraints, MealFeedback, RecommendationOptions, RefinementRequest, TasteProfile, TasteDocument } from '../lib/contracts';
import { profileFingerprint, restoreTasteDocument } from '../lib/memory/restore';
import { emptyRefinements } from '../lib/refinements';
import { initialState, restoreState, STORAGE_KEY, LEGACY_KEY, type MenuSelection, type SavedState } from '../lib/storage';
import type { Axis } from '../lib/preferences';
import { isContract } from '../lib/validation';
import { restoreDetective, restoreDraft, type DetectiveDraft, type DetectiveRecord } from '../lib/detective/model';

type AppContext = SavedState & {
  ready: boolean; storageWarning: boolean;
  setTaste: (taste: TasteProfile) => void;
  saveDetective: (taste: TasteProfile, record: DetectiveRecord) => void;
  setDetectiveDraft: (draft: DetectiveDraft | null) => void;
  setConstraints: (constraints: DiningConstraints) => void;
  setRecommendationOptions: (options: RecommendationOptions) => void;
  refinements: RefinementRequest;
  setRefinements: (value: RefinementRequest) => void;
  updateAxis: (axis: Axis, value: number | null) => void;
  setExploration: (value: number) => void;
  selectMenu: (selection: MenuSelection) => void;
  clearSelection: () => void;
  addFeedback: (feedback: MealFeedback) => void;
  correctFeedback: (feedback: MealFeedback) => void;
  removeFeedback: (id: string) => void;
  restoreCloudTaste: (document: TasteDocument, expectedFingerprint: string) => void;
  reset: () => void;
};
const Context = createContext<AppContext | null>(null);

export function AppProvider({ children, sessionOnly = false }: { children: ReactNode; sessionOnly?: boolean }) {
  const key = sessionOnly ? 'dinetuned-guided-demo-state' : STORAGE_KEY;
  const [data, setData] = useState<SavedState>(initialState);
  const latest = useRef(data); latest.current = data;
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  // Ephemeral meal intent: survives navigation within this menu, never localStorage/DNA.
  const [refinements, setRefinements] = useState<RefinementRequest>(emptyRefinements);
  useEffect(() => {
    try { setData(restoreState(sessionOnly ? sessionStorage.getItem(key) : localStorage.getItem(key), sessionOnly ? null : localStorage.getItem(LEGACY_KEY))); }
    catch { setStorageWarning(true); }
    setReady(true);
  }, [key, sessionOnly]);
  useEffect(() => {
    if (!ready) return;
    try { (sessionOnly ? sessionStorage : localStorage).setItem(key, JSON.stringify(data)); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, [data, ready, key, sessionOnly]);

  const setTaste = (taste: TasteProfile) => {
    if (!isContract<TasteProfile>('TasteProfile', taste)) return;
    setData(previous => ({ ...previous, taste,
      constraints: { ...previous.constraints, dietary_restrictions: taste.dietary_restrictions, allergies: taste.allergies } }));
  };
  const setConstraints = (constraints: DiningConstraints) => {
    if (!isContract<DiningConstraints>('DiningConstraints', constraints)) return;
    setData(previous => {
      const essentialsChanged = JSON.stringify([constraints.dietary_restrictions, constraints.allergies])
        !== JSON.stringify([previous.constraints.dietary_restrictions, previous.constraints.allergies]);
      return { ...previous, constraints,
        // Update stale essentials, but never let a new craving erase unfinished tasting notes.
        detectiveDraft: previous.detectiveDraft && essentialsChanged ? { ...previous.detectiveDraft, answers: { ...previous.detectiveDraft.answers,
          dietary_restrictions: constraints.dietary_restrictions, allergies: constraints.allergies } } : previous.detectiveDraft,
        taste: { ...previous.taste, dietary_restrictions: constraints.dietary_restrictions, allergies: constraints.allergies } };
    });
  };
  const saveDetective = (taste: TasteProfile, record: DetectiveRecord) => {
    const detective = restoreDetective(record);
    if (!isContract<TasteProfile>('TasteProfile', taste) || !detective) return;
    setData(previous => ({ ...previous, taste, detective, detectiveDraft: null, tasteEdits: { axes: [], exploration: false },
      constraints: { ...previous.constraints, dietary_restrictions: taste.dietary_restrictions, allergies: taste.allergies } }));
  };
  const updateAxis = (axis: Axis, value: number | null) => {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) return;
    setData(previous => ({ ...previous, tasteEdits: { ...previous.tasteEdits, axes: [...new Set([...previous.tasteEdits.axes, axis])] }, taste: { ...previous.taste, source: 'user_edited',
      axes: { ...previous.taste.axes, [axis]: value }, updated_at: new Date().toISOString() } }));
  };
  const setExploration = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    setData(previous => ({ ...previous, tasteEdits: { ...previous.tasteEdits, exploration: true }, taste: { ...previous.taste, exploration: value,
      source: 'user_edited', updated_at: new Date().toISOString() } }));
  };
  const addFeedback = (feedback: MealFeedback) => {
    if (!isContract<MealFeedback>('MealFeedback', feedback)) return;
    setData(previous => previous.feedback.some(item => item.id === feedback.id) ? previous
      : { ...previous, feedback: [feedback, ...previous.feedback] });
  };
  const reset = () => {
    // Reset is followed by navigation; clear persistence synchronously before unload.
    try { (sessionOnly ? sessionStorage : localStorage).removeItem(key); if (!sessionOnly) localStorage.removeItem(LEGACY_KEY); }
    catch { setStorageWarning(true); }
    setData(initialState());
    setRefinements(emptyRefinements());
  };
  const restoreCloudTaste = (document: TasteDocument, expectedFingerprint: string) => {
    if (sessionOnly) throw new Error('Cloud recovery is unavailable in the isolated demo.');
    const restored = restoreTasteDocument(latest.current, document, expectedFingerprint);
    const stored = restoreState(localStorage.getItem(STORAGE_KEY), localStorage.getItem(LEGACY_KEY));
    if (profileFingerprint(stored) !== expectedFingerprint) throw new Error('Your browser profile changed in another tab. Reload and review the restore again.');
    // Retain a recoverable local pre-restore snapshot before any replacement.
    try {
      localStorage.setItem(STORAGE_KEY + '-before-cloud-restore', JSON.stringify(latest.current));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    } catch { throw new Error('Browser storage is unavailable. Taste DNA was not restored.'); }
    latest.current = restored; setData(restored); setRefinements(emptyRefinements());
  };
  return <Context.Provider value={{ ...data, ready, storageWarning, setTaste, setConstraints, saveDetective, refinements,
    setRefinements: value => { if (isContract('RefinementRequest', value)) setRefinements(value); },
    setRecommendationOptions: options => { if (isContract('RecommendationOptions', options)) setData(previous => ({ ...previous, recommendationOptions: options })); },
    setDetectiveDraft: draft => setData(previous => ({ ...previous, detectiveDraft: restoreDraft(draft) })),
    updateAxis, setExploration, selectMenu: selection => {
      if (data.selection?.restaurant_id !== selection.restaurant_id || data.selection?.menu_version !== selection.menu_version) setRefinements(emptyRefinements());
      setData(previous => ({ ...previous, selection }));
    },
    clearSelection: () => { setRefinements(emptyRefinements()); setData(previous => ({ ...previous, selection: null })); }, addFeedback,
    correctFeedback: value => { if (isContract('MealFeedback', value)) setData(previous => ({ ...previous, feedback: previous.feedback.map(item => item.id === value.id ? value : item) })); },
    removeFeedback: id => setData(previous => ({ ...previous, feedback: previous.feedback.filter(item => item.id !== id) })),
    restoreCloudTaste, reset }}>
    {ready ? children : <div className="app-loading" role="status"><span className="loading-mark">d.</span><p>Setting your table…</p></div>}
  </Context.Provider>;
}
export function useDineTuned() {
  const context = useContext(Context);
  if (!context) throw new Error('AppProvider is missing');
  return context;
}
