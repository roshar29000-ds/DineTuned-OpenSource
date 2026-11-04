'use client';
import { useEffect, useRef, useState } from 'react';
import { useIdentity } from '../IdentityProvider';
import { useDineTuned } from '../AppProvider';
import type { TasteBackupRecord } from '../../lib/contracts';
import { tasteDocument } from '../../lib/memory-repository';
import { profileFingerprint } from '../../lib/memory/restore';

export function CloudMemoryStatus() {
  const { state, retry } = useIdentity();
  const local = useDineTuned();
  const [backup, setBackup] = useState<TasteBackupRecord | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [restoreReview, setRestoreReview] = useState<{ backup: TasteBackupRecord; fingerprint: string } | null>(null);
  const generation = useRef(0);
  const refresh = async () => {
    if (state.status !== 'ready') return;
    const id = ++generation.current;
    setBusy(true); setMessage('Checking your private cloud backup…'); setBackup(undefined);
    try {
      const value = await state.repository.profile();
      if (id !== generation.current) return;
      setBackup(value.profile);
      setMessage(value.profile ? 'A Taste DNA backup is available. Your current browser profile has not been replaced.' : 'No Taste DNA backup yet. You choose when to save one.');
    } catch (error) {
      if (id === generation.current) setMessage(error instanceof Error ? error.message : 'Cloud status is unavailable.');
    } finally { if (id === generation.current) setBusy(false); }
  };
  useEffect(() => {
    generation.current++; setBackup(undefined); setBusy(false); setMessage(''); setRestoreReview(null);
    void refresh();
    return () => { generation.current++; };
    // Each verified identity/repository change invalidates previous asynchronous results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const save = async () => {
    if (state.status !== 'ready' || busy || backup === undefined) return;
    const id = ++generation.current;
    setBusy(true); setMessage('Saving this Taste DNA snapshot…');
    try {
      const saved = await state.repository.saveProfile({ document: tasteDocument(local), expected_revision: backup?.revision ?? null });
      if (id !== generation.current) return;
      setBackup(saved); setMessage('Taste DNA snapshot saved to your private cloud backup. Later Taste DNA edits need another explicit backup.');
    } catch (error) {
      if (id === generation.current) { setBackup(undefined); setMessage(error instanceof Error ? error.message : 'The cloud save could not be confirmed.'); }
    } finally { if (id === generation.current) setBusy(false); }
  };
  const restore = async () => {
    if (state.status !== 'ready' || !restoreReview || busy) return;
    const review = restoreReview, id = ++generation.current;
    setBusy(true);
    try {
      const current = (await state.repository.profile()).profile;
      if (id !== generation.current) return;
      if (!current || current.id !== review.backup.id || current.revision !== review.backup.revision
        || JSON.stringify(current.document) !== JSON.stringify(review.backup.document)) {
        setBackup(current); throw new Error('The cloud backup changed. Review the latest snapshot before restoring.');
      }
      local.restoreCloudTaste(current.document, review.fingerprint);
      setMessage('Cloud Taste DNA restored in this browser. Existing dietary restrictions and allergies were retained. The cloud backup was not changed.');
    } catch (error) { if (id === generation.current) setMessage(error instanceof Error ? error.message : 'Taste DNA could not be restored.'); }
    finally { if (id === generation.current) { setBusy(false); setRestoreReview(null); } }
  };
  return <section className="cloud-memory-status" aria-labelledby="cloud-memory-title">
    <div><span className="eyebrow">YOUR TASTE, REMEMBERED</span><h2 id="cloud-memory-title">{state.status === 'ready' ? 'A private place for your palate.' : 'Your food story stays with you.'}</h2>
      <p>{state.status === 'local' ? 'Local-only mode. Taste DNA and your dining diary are saved in this browser. Cloud storage is not configured.'
        : state.status === 'connecting' ? 'Checking cloud identity. Your local Taste DNA and diary remain available.'
        : state.status === 'error' ? state.message : `${state.anonymous ? 'Guest' : 'Account'} identity connected. Taste DNA backup is optional; dining records show their own save status below.`}</p>
      {state.status === 'ready' && <><p role="status" aria-live="polite">{message}</p>
        <details className="cloud-memory-detail"><summary>Session reference for a controlled test</summary>
          <code>{state.userId}</code><p>This is your guest ID, not an access token. Use it only to scope a local test.</p></details>
        {backup && <p className="cloud-memory-detail">Cloud snapshot · {new Date(backup.updated_at).toLocaleString()} · revision {backup.revision}</p>}
        <p className="cloud-memory-detail">{state.anonymous ? 'Keep this browser’s session to retain guest access. Account upgrades and cross-device recovery come later. ' : ''}
          {backup ? 'Updating the backup replaces its saved snapshot with your current Taste DNA. ' : ''}Your local profile changes only if you explicitly restore it.</p></>}
      {restoreReview && <div className="memory-confirm" role="group" aria-label="Confirm Taste DNA restore"><h3>Restore revision {restoreReview.backup.revision}?</h3>
        <p>This replaces your local Taste DNA and unfinished Detective answers. A copy of your current browser profile is kept locally. Existing allergy and dietary restrictions are retained; meal preferences and feedback are preserved.</p>
        <button className="button button-primary" onClick={restore} disabled={busy}>Confirm restore</button>
        <button className="button button-outline" onClick={() => setRestoreReview(null)} disabled={busy}>Cancel restore</button></div>}
    </div>
    <div className="cloud-memory-actions">
      {state.status === 'ready' && <><button className="button button-primary" onClick={save} disabled={busy || backup === undefined || !local.taste.complete}>
        {busy ? 'Working…' : backup ? 'Update Taste DNA backup' : 'Back up Taste DNA'}</button>
        <button className="button button-outline" onClick={refresh} disabled={busy}>Refresh cloud status</button></>}
      {state.status === 'ready' && backup && <button className="button button-outline" disabled={busy || !!restoreReview}
        onClick={() => setRestoreReview({ backup, fingerprint: profileFingerprint(local) })}>Restore cloud Taste DNA</button>}
      {state.status === 'error' && <button className="button button-outline" onClick={retry}>Retry cloud connection</button>}
    </div>
  </section>;
}
