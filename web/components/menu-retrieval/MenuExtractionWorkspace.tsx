'use client';
import { useEffect, useRef, useState } from 'react';
import type { MenuDiscoveryHandoff, MenuExtractionResult, MenuSourceResult } from '../../lib/contracts';
import { extractMenuSources } from '../../lib/menu-retrieval/extraction';
import { extractableSource } from '../../lib/menu-retrieval/extracted-presentation';
import { Icon } from '../UI';
import { MenuSourceFallback } from './MenuSourceFallback';
import { RealRestaurantMenu } from './RealRestaurantMenu';
import { useIdentity } from '../IdentityProvider';

const service = { dine_in: 'Dine-in label', delivery: 'Delivery', catering: 'Catering', takeaway: 'Takeaway / ordering', unknown: 'Service not confirmed' };
const branch = { exact: 'Selected branch linked', site_wide: 'Multiple locations', unknown: 'Branch unconfirmed', other_branch: 'Address mismatch' };

/** Mounted for one user, branch and immutable source manifest; never persisted. */
export function MenuExtractionWorkspace({ handoff, sources, accessToken }: {
  handoff: MenuDiscoveryHandoff; sources: MenuSourceResult; accessToken: () => Promise<string>;
}) {
  const identity = useIdentity().state;
  const table = identity.status === 'ready' ? identity.table : null;
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<MenuExtractionResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [open, setOpen] = useState(true);
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  const supported = sources.candidates.filter(extractableSource);
  const authorized = !!sources.extraction_token && !!handoff.source_discovery_token;
  function clear() {
    generation.current++; controller.current?.abort(); controller.current = null;
    table?.clearExtraction();
    setResult(null); setError(''); setMessage(''); setBusy(false);
  }
  function choose(ids: string[]) { clear(); setSelected(ids); }
  async function extract() {
    if (!authorized || !selected.length || selected.length > 8 || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const current = ++generation.current;
    setBusy(true); setError(''); setMessage(''); setResult(null);
    try {
      const data = await extractMenuSources(handoff, sources, crypto.randomUUID(), accessToken, abort.signal, selected);
      if (current !== generation.current || abort.signal.aborted) return;
      if (data.menu.total_items) table?.setExtraction(handoff, data);
      setResult(data); if (data.menu.total_items) setOpen(false);
    } catch (cause) {
      if (current === generation.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Menu extraction is unavailable.');
    } finally {
      if (current === generation.current) { setBusy(false); controller.current = null; }
    }
  }
  const noItems = result !== null && result.menu.total_items === 0;
  const fallback = !!error || noItems || !supported.length || sources.status !== 'sources_found';
  return <div className="source-results">
    <div className="source-result-heading" role="status"><h3>{sources.status === 'sources_found' ? 'Menu sources to explore.' : sources.status === 'needs_review' ? 'These sources need a closer look.' : 'A trustworthy menu source isn’t available yet.'}</h3>
      <p>{sources.candidates.length ? 'Choose the sources to read. Nothing is extracted until you ask.' : 'Try a more specific official branch page, or preview a menu you already have below.'}</p></div>
    <details className="source-selection" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary ref={summary}>Choose menu sources <span>{selected.length} selected</span></summary>
      {!authorized && <p className="source-notice" role="status">This source check has no extraction authorization. Run Find menu sources again with a current branch selection. No lookup is repeated automatically.</p>}
      <fieldset><legend>Select menu documents to extract</legend>
        <p>Choose up to eight HTML or text-PDF sources. Select multiple documents to include different menu sections. An image or scanned PDF still needs vision extraction, which is not connected.</p>
        {supported.length > 1 && supported.length <= 8 && <button type="button" className="text-button" disabled={!authorized} onClick={() => choose(supported.map(source => source.id))}>Select all {supported.length} supported sources</button>}
        {sources.candidates.map(candidate => {
          const eligible = extractableSource(candidate);
          return <article key={candidate.id} className={'source-candidate' + (candidate.id === sources.recommended_candidate_id ? ' preferred' : '')}>
            <div className="source-candidate-top"><span>{candidate.format === 'unknown' ? 'FORMAT UNVERIFIED' : candidate.format.toUpperCase()}</span>
              <span>{candidate.confidence === 'high' ? 'Strong branch evidence' : candidate.confidence === 'medium' ? 'Supported source link' : 'Limited evidence'}</span></div>
            <h4><a href={candidate.source_url} target="_blank" rel="noopener noreferrer">{candidate.title}<Icon name="arrow" size={15}/></a></h4>
            <p className="source-url">{candidate.source_url}</p>
            <div className="source-tags"><span>{service[candidate.menu_type]}</span><span>{branch[candidate.branch_relevance]}</span>
              <span>{candidate.freshness === 'outdated' ? `Older menu · ${candidate.date_label}` : candidate.date_label ? `Menu date label · ${candidate.date_label}` : 'Freshness unconfirmed'}</span></div>
            <p className="source-check-time">{candidate.verified_at ? `Source checked ${new Date(candidate.verified_at).toLocaleString()}` : 'Source content not checked'} · Discovery evidence only</p>
            <label className="source-select-option"><input type="checkbox" checked={selected.includes(candidate.id)}
              disabled={!authorized || !eligible || selected.length >= 8 && !selected.includes(candidate.id)}
              onChange={event => choose(event.target.checked ? [...selected, candidate.id] : selected.filter(id => id !== candidate.id))}/>
              <span>Select {candidate.title}</span></label>
            {!eligible && <p className="source-check-time">{candidate.format === 'image' ? 'Image extraction is not supported yet.' : 'This source is not eligible for extraction; branch, access, service or date evidence needs review.'}</p>}
            <details><summary>Evidence &amp; limitations</summary><p>Discovered from <a href={candidate.discovered_from} target="_blank" rel="noopener noreferrer">{candidate.discovered_from}</a></p>
              <ul>{candidate.evidence.map((e, i) => <li key={i}>{e.detail} <a href={e.source_url} target="_blank" rel="noopener noreferrer">Source</a></li>)}</ul>
              <ul>{candidate.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
          </article>;
        })}
      </fieldset>
      <details className="source-check-details"><summary>About this source check</summary><ul>{sources.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul>
        <p>{sources.requests_made} bounded website requests · No Google or Meta API calls by this source check.</p></details>
    </details>
    <div className="source-extract-actions"><button type="button" className="button button-primary" disabled={!authorized || !selected.length || busy} onClick={() => void extract()}>
      <Icon name="book" size={17}/>{busy ? 'Reading selected menus…' : result?.menu.total_items ? 'Extract selected menus again' : 'Extract selected menus'}</button>
      <span>{selected.length} selected · HTML / text-PDF parsing · no AI processing</span></div>
    {busy && <div className="source-extraction-progress"><p role="status"><span className="rs-input-spinner"/> Retrieving your selected documents, reading dishes and checking source evidence…</p>
      <button className="text-button" onClick={() => { clear(); setMessage('Stopped waiting. The server may still finish its current check; no result will be displayed.'); }}>Stop waiting</button></div>}
    {message && <p role="status">{message}</p>}
    {error && <div className="source-notice" role="alert"><strong>The menu couldn’t be confirmed.</strong><p>{error}</p><p>Check your connection or recheck the sources. Expired branch selections need a fresh explicit selection. No automatic retry was made.</p></div>}
    {noItems && <div className="source-notice" role="status"><h3>{result.vision_status !== 'not_needed' ? 'This menu needs image reading.' : 'No reliable dish records were recovered.'}</h3>
      <p>{result.vision_status !== 'not_needed' ? 'Scanned PDFs and menu images are not supported yet. No dishes were invented or accepted from a mock.' : 'The source may be blocked, unreadable or missing usable menu text. Try another official source.'}</p>
      <details><summary>Extraction details</summary><ul>{result.menu.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details></div>}
    {result && result.menu.total_items > 0 && <RealRestaurantMenu result={result} reviewSources={() => { setOpen(true); summary.current?.focus(); summary.current?.scrollIntoView({ block: 'start' }); }}/>}
    {fallback ? <MenuSourceFallback handoff={handoff}/> : <details className="source-file-options"><summary>Missing a section, or have another menu?</summary><MenuSourceFallback handoff={handoff}/></details>}
  </div>;
}
