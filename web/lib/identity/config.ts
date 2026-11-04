export type CloudConfig = { mode: 'local' } | { mode: 'supabase'; url: string; publishable_key: string };

/** Used on the server BEFORE publishing config; a misplaced secret never enters a browser bundle. */
export function cloudConfiguration(rawUrl?: string, rawKey?: string): CloudConfig {
  const value = rawUrl?.trim().replace(/\/$/, '') || '';
  const key = rawKey?.trim() || '';
  if (!value && !key) return { mode: 'local' };
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Cloud configuration is invalid.'); }
  const hosted = url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && !url.port;
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '54321';
  if ((!hosted && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('Cloud configuration must use a project URL and publishable key.');
  return { mode: 'supabase', url: url.origin, publishable_key: key };
}
