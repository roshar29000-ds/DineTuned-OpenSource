'use client';
import { useEffect, useRef, useState } from 'react';
import type { MenuDiscoveryHandoff, MenuSourceResult } from '../../lib/contracts';
import { discoverMenuSources } from '../../lib/menu-retrieval/source-discovery';
import { useIdentity } from '../IdentityProvider';
import { Eyebrow, Icon } from '../UI';
import { MenuSourceFallback } from './MenuSourceFallback';
import { MenuExtractionWorkspace } from './MenuExtractionWorkspace';
import { signedTokenExpired } from '../../lib/menu-retrieval/real-session';

export function MenuSourceDiscovery({ handoff }: { handoff: MenuDiscoveryHandoff }) {
  const { state } = useIdentity();
  const [website, setWebsite] = useState('');
  const [result, setResult] = useState<MenuSourceResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  const owner = state.status === 'ready' ? state.userId : null;
  const table = state.status === 'ready' ? state.table : null;
  const restoredMenu = table?.getExtraction(handoff);
  useEffect(() => {
    generation.current++; controller.current?.abort(); controller.current = null;
    setResult(null); setError(''); setBusy(false);
    return () => { generation.current++; controller.current?.abort(); };
  }, [owner, handoff]);
  function changeWebsite(value: string) {
    generation.current++; controller.current?.abort(); controller.current = null;
    table?.clearExtraction();
    setWebsite(value); setResult(null); setError(''); setBusy(false);
  }
  async function discover() {
    if (state.status !== 'ready' || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const current = ++generation.current;
    table?.clearExtraction();
    setBusy(true); setError(''); setResult(null);
    try {
      const data = await discoverMenuSources(handoff, website, crypto.randomUUID(), state.getAccessToken, abort.signal);
      if (!abort.signal.aborted && current === generation.current) setResult(data);
    } catch (cause) {
      if (!abort.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : 'The website check is unavailable.');
    } finally {
      if (current === generation.current) { setBusy(false); controller.current = null; }
    }
  }
  const verifiedSelection = !!handoff.source_discovery_token && !signedTokenExpired(handoff.source_discovery_token);
  const closed = handoff.restaurant.business_status === 'CLOSED_PERMANENTLY';
  return <section className="source-discovery" aria-labelledby="menu-source-title">
    <header><Eyebrow>THE RESTAURANT’S OWN WORDS</Eyebrow><h2 id="menu-source-title">Find the menu. <em>Check the source.</em></h2>
      <p>Start with this restaurant’s official website. We’ll check public menu pages and linked PDFs against your selected branch.</p></header>
    <p className="source-scope">Website lookup is not connected yet, so a website URL is needed. First check the sources, then choose which menu documents to extract. Allergy safety is not established by menu text.</p>
    {!verifiedSelection && <p className="source-notice" role="status">This older or expired selection needs a fresh server verification before checking websites. A new Google lookup requires separate approval; none will run automatically.</p>}
    {closed && <p className="source-notice">Menu source checks are unavailable for a restaurant reported permanently closed.</p>}
    <form onSubmit={event => { event.preventDefault(); void discover(); }}>
      <label htmlFor="official-menu-website">Restaurant website URL</label>
      <div className="source-input-row"><input id="official-menu-website" type="url" inputMode="url" autoComplete="off" maxLength={2048}
        placeholder="https://restaurant.example/locations/your-branch" value={website} onChange={event => changeWebsite(event.target.value)} aria-describedby="source-website-hint"/>
        <button className="button button-primary" type="submit" disabled={!verifiedSelection || closed || state.status !== 'ready' || !website.trim() || busy}>
          <Icon name="search" size={16}/>{busy ? 'Checking sources…' : 'Find menu sources'}</button></div>
      <p id="source-website-hint">Use a public HTTPS link. We respect website restrictions and never bypass login or CAPTCHA.</p>
    </form>
    {busy && <p className="source-progress" role="status"><span className="rs-input-spinner"/> Checking the website, branch evidence and menu links…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && state.status === 'ready' && <MenuExtractionWorkspace key={owner + result.request_id} handoff={handoff} sources={result} accessToken={state.getAccessToken}/>}
    {error && <MenuSourceFallback handoff={handoff}/>}
    {!result && !error && (restoredMenu ? <MenuSourceFallback handoff={handoff}/>
      : <details className="source-file-options"><summary>Have a menu file or QR code instead?</summary><MenuSourceFallback handoff={handoff}/></details>)}
  </section>;
}
