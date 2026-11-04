import type { SupabaseClient } from '@supabase/supabase-js';

type Auth = Pick<SupabaseClient['auth'], 'getSession' | 'getUser' | 'signInAnonymously'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type GuestIdentity = { id: string; isAnonymous: boolean };

/** The marker is a recovery guard, never an authorization credential. */
export async function ensureIdentity(auth: Auth, storage: Storage, markerKey: string): Promise<GuestIdentity> {
  let previous: string | null;
  try { previous = storage.getItem(markerKey); }
  catch { throw new Error('Browser storage is unavailable. Cloud identity cannot be kept reliably; your local experience remains available.'); }
  const current = await auth.getSession();
  if (current.error) throw new Error('Your cloud session could not be restored. Local Taste DNA is unchanged.');
  let session = current.data.session;
  if (!session) {
    if (previous) throw new Error('This browser had a cloud identity but its session is missing. We have not created a replacement or changed your local Taste DNA.');
    const signed = await auth.signInAnonymously();
    if (signed.error || !signed.data.session) throw new Error('Guest sign-in is unavailable. Continue locally; check anonymous sign-in settings before retrying.');
    session = signed.data.session;
  }
  // getSession is only for token management; getUser verifies identity with Auth.
  const verified = await auth.getUser(session.access_token);
  const user = verified.data.user;
  if (verified.error || !user || user.role !== 'authenticated' || typeof user.is_anonymous !== 'boolean'
      || user.id !== session.user.id) throw new Error('Cloud identity could not be verified. Local Taste DNA is unchanged.');
  if (previous && previous !== user.id) throw new Error('The cloud identity changed. We kept your local data separate; automatic merging is disabled.');
  try { storage.setItem(markerKey, user.id); }
  catch { throw new Error('Cloud identity could not be remembered in this browser. No local Taste DNA was replaced.'); }
  return { id: user.id, isAnonymous: user.is_anonymous };
}

/** React Strict Mode and concurrent callers share one in-flight sign-in. */
export function identityInitializer(action: () => Promise<GuestIdentity>) {
  let pending: Promise<GuestIdentity> | null = null;
  return () => {
    if (!pending) pending = action().finally(() => { pending = null; });
    return pending;
  };
}
