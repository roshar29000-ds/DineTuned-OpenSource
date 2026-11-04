import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudConfiguration } from './config';
import { ensureIdentity, identityInitializer, type GuestIdentity } from './session';

type CloudRuntime = { client: SupabaseClient; initialize: () => Promise<GuestIdentity> };
let runtime: Promise<CloudRuntime | null> | null = null;

export function identityRuntime(): Promise<CloudRuntime | null> {
  if (runtime) return runtime;
  runtime = (async () => {
    const response = await fetch('/api/identity/config', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Cloud configuration is unavailable. Your browser records remain local.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('mode' in data)) throw new Error('Cloud configuration could not be verified.');
    if (data.mode === 'local') return null;
    if (data.mode !== 'supabase' || !('url' in data) || typeof data.url !== 'string'
      || !('publishable_key' in data) || typeof data.publishable_key !== 'string') throw new Error('Cloud configuration could not be verified.');
    const config = cloudConfiguration(data.url, data.publishable_key);
    if (config.mode !== 'supabase') throw new Error('Cloud configuration could not be verified.');
    const { createClient } = await import('@supabase/supabase-js');
    const namespace = `dinetuned-supabase-${new URL(config.url).host}`;
    const client = createClient(config.url, config.publishable_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storageKey: namespace },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
    const initialize = identityInitializer(async () => {
      const action = () => ensureIdentity(client.auth, window.localStorage, `${namespace}-identity`);
      // A second tab must re-read the session after the first finishes signup.
      return navigator.locks ? await navigator.locks.request(`${namespace}-bootstrap`, action) : await action();
    });
    return { client, initialize };
  })().catch(() => {
    runtime = null;
    throw new Error('Cloud connection is unavailable. Your local Taste DNA and dining diary are unchanged.');
  });
  return runtime;
}
