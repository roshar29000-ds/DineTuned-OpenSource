'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../UI';
import { GoogleAttribution } from './GoogleAttribution';

export type AutocompleteMatch = { id: string; name: string; branch: string; address: string | null; cuisine: string; item_count?: number; distance_km: number | null };

export function RestaurantAutocomplete<T extends AutocompleteMatch>({ query, onQuery, matches, loading, error, onSelect, retry, onSubmit,
  submittedLabel = null, edited = false, explicitSearch = false, persistentResults = false, tools, google = false, disabled = false }: {
  query: string; onQuery: (value: string) => void; matches: T[]; loading: boolean; error: string | null;
  onSelect: (restaurant: T) => void; retry: () => void;
  onSubmit?: () => void; submittedLabel?: string | null; edited?: boolean; explicitSearch?: boolean; persistentResults?: boolean;
  tools?: ReactNode; google?: boolean; disabled?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const signature = matches.map(match => match.id).join('|') + query;
  useEffect(() => { setActive(-1); }, [signature, loading]);
  useEffect(() => {
    if (active >= 0 && open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  function select(match: T) { setOpen(false); setActive(-1); onSelect(match); }
  const expanded = persistentResults && !!submittedLabel || open && query.trim().length >= (google ? 3 : 1) && !disabled && !explicitSearch;
  return <div className="rs-combobox" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); }
  }}>
    <div className="rs-search-tools"><label className="rs-search-label" htmlFor={id}>YOUR RESTAURANT, BY NAME</label>{tools}</div>
    <div className={'rs-search-input' + (expanded ? ' is-open' : '')}><Icon name="search" size={22}/>
      <input ref={input} id={id} role="combobox" aria-label="Restaurant name or neighborhood" aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={id+'-results'} aria-activedescendant={expanded && active >= 0 && matches[active] ? `${id}-${active}` : undefined}
        aria-describedby={id+'-hint'} autoComplete="off" spellCheck={false} maxLength={80} value={query} disabled={disabled}
        placeholder={explicitSearch ? 'Enter the full restaurant name…' : 'A restaurant, a neighborhood, a cuisine…'} onFocus={() => setOpen(true)}
        onChange={event => { onQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault(); setOpen(true);
            if (!loading && matches.length) setActive(value => event.key === 'ArrowDown' ? (value + 1) % matches.length : value <= 0 ? matches.length - 1 : value - 1);
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (explicitSearch && edited && onSubmit) onSubmit();
            else if (expanded && active >= 0 && !loading && matches[active]) select(matches[active]);
            else if (explicitSearch && onSubmit) onSubmit();
            else setOpen(true);
          }
        }}/>
      {loading && query && <span className="rs-input-spinner" aria-hidden="true"/>}
      {query && !disabled && <button type="button" className="rs-clear" aria-label="Clear restaurant search" onClick={() => { onQuery(''); setActive(-1); input.current?.focus(); }}><Icon name="close" size={18}/></button>}
    </div>
    <span id={id+'-hint'} className="sr-only">{explicitSearch ? 'Enter a full restaurant name and optional city, then press Enter or Search Restaurants. Returned branches stay visible until you make another search.' : google ? 'Google Maps results. Enter at least 3 characters.' : 'Fictional demo results.'} Use arrow keys to inspect branches and Enter to choose. No restaurant is selected automatically.</span>
    {expanded && <div className={'rs-suggestions' + (persistentResults ? ' is-inline' : '')}>
      <div className="rs-suggestion-heading"><span>{submittedLabel ? <>Results for <strong>{submittedLabel}</strong></> : 'Matching tables'}</span>{google ? <GoogleAttribution/> : <span>FICTIONAL DEMO</span>}</div>
      {edited && <div className="rs-edited-note" role="status">Your inputs changed. These are the branches from your last search; choose one or search again for updated results.</div>}
      <div id={id+'-results'} role="listbox" aria-label="Matching restaurant branches" aria-busy={loading}>
        {!loading && !error && matches.map((match, index) => <div id={`${id}-${index}`} key={match.id} role="option" aria-selected={index === active}
          className={'rs-suggestion' + (index === active ? ' active' : '')} onMouseDown={event => event.preventDefault()}
          onClick={() => select(match)}><span className="rs-venue-monogram" aria-hidden="true">{match.name[0]}<i/></span>
          <span className="rs-suggestion-copy"><strong>{match.name}{match.branch && <span>{match.branch}</span>}</strong><small>{match.address || 'Address unavailable'}</small>
            <span className="rs-suggestion-meta">{match.cuisine}{!google && ` · ${match.item_count} sample dishes`}{match.distance_km !== null ? ` · ${match.distance_km} km` : ''}</span></span><Icon name="arrow" size={16}/></div>)}
      </div>
      <div role="status" className={loading || error || !matches.length ? 'rs-dropdown-message' : 'sr-only'}>
        {loading ? google ? 'Looking for restaurant branches…' : 'Looking for matching demo branches…' : error ? error : matches.length ? `${matches.length} matching branches. Choose one to continue.` : google ? 'No matching dining locations. Try a fuller name or add a city or area.' : 'No matching sample venues. Try Saigon Table, a cuisine, or a neighborhood.'}
      </div>
      {error && <button type="button" className="text-button rs-retry-search" onClick={retry}>{google ? 'Start a new search' : 'Retry search'}</button>}
      <div className="rs-dropdown-foot"><Icon name="location" size={13}/> Choose the branch you have in mind.{!google && ' Addresses are fictional.'}</div>
    </div>}
  </div>;
}
