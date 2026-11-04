'use client';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useIdentity } from '../IdentityProvider';
import { useDineTuned } from '../AppProvider';
import { Eyebrow, Icon } from '../UI';
import { placeCategory } from '../../lib/restaurants/places';
import { usePlacesSearch } from '../../lib/restaurants/use-places-search';
import { RestaurantAutocomplete } from './RestaurantAutocomplete';
import { GoogleAttribution } from './GoogleAttribution';
import { MenuSourceDiscovery } from '../menu-retrieval/MenuSourceDiscovery';
import { clearGuestTable } from '../../lib/menu-retrieval/table-backup';

export function PlacesSearch({ enabled, message, showDemo }: { enabled: boolean; message: string; showDemo: () => void }) {
  const { state, retry } = useIdentity();
  const { clearSelection } = useDineTuned();
  // Owned by the verified identity, not this component or an auth callback.
  const client = state.status === 'ready' ? state.places : null;
  const table = state.status === 'ready' ? state.table : null;
  const [locating, setLocating] = useState(false), [locationMessage, setLocationMessage] = useState('');
  const [tableWarning, setTableWarning] = useState('');
  const geoRequest = useRef(0);
  useEffect(() => () => { geoRequest.current++; }, []);
  const result = usePlacesSearch(client, () => {
    const oldToken = table?.getSelection()?.source_discovery_token;
    clearSelection(); table?.clear();
    if (oldToken && state.status === 'ready') void clearGuestTable(oldToken, state.getAccessToken)
      .catch(() => setTableWarning('Your old private table could not be cleared from this device. Refresh before choosing another branch.'));
  });
  const { query, area, location } = result.draft;
  const selected = result.selected || table?.getSelection() || null;
  useEffect(() => { if (result.selected) table?.setSelection(result.selected); }, [result.selected, table]);
  function requestLocation() {
    if (location) { geoRequest.current++; result.setDraft({ location: null }); setLocationMessage('Nearby preference removed.'); return; }
    if (!navigator.geolocation) { setLocationMessage('Location is unavailable. You can still search by name and city.'); return; }
    const request = ++geoRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== geoRequest.current) return;
      result.setDraft({ location: { latitude: position.coords.latitude, longitude: position.coords.longitude } });
      setLocating(false); setLocationMessage('Nearby matches are preferred. Results can still include other areas.');
    }, () => {
      if (request !== geoRequest.current) return;
      setLocating(false); setLocationMessage('Location wasn’t shared. Search by restaurant name and city instead.');
    }, { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false });
  }
  if (state.status === 'ready' && state.tableLoading) return <section className="places-setup rs-search-panel" role="status">
    <Eyebrow>YOUR TABLE</Eyebrow><h2>Finding your place again.</h2><p>Restoring your private restaurant and menu snapshot. No Google request is being made.</p>
  </section>;
  if ((!enabled && !selected) || !client) return <section className="places-setup rs-search-panel" aria-label="Real restaurant search">
    <Eyebrow>REAL PLACES. YOUR CHOICE.</Eyebrow><h2>{!enabled ? 'Live search is paused.' : state.status === 'connecting' ? 'Connecting your guest identity…' : 'Your guest session is needed.'}</h2>
    <p>{!enabled ? message : state.status === 'error' ? state.message : 'Real restaurant search needs a secure guest session. The fictional menu experience remains available.'}</p>
    <div className="places-actions">{enabled && state.status === 'error' && <button className="button button-outline" onClick={retry}>Reconnect guest session</button>}
      <button className="button button-primary" onClick={showDemo}>Explore fictional demo menus</button></div>
  </section>;
  return <>
    {tableWarning && <p className="source-notice" role="alert">{tableWarning}</p>}
    {!enabled && <p className="source-notice" role="status">New Google searches are paused. Your already selected branch and any current extracted menu remain available in this tab.</p>}
    <section className="rs-search-panel places-search" aria-label="Real restaurant search">
      <div className="places-area"><label htmlFor="places-area">City or area <span>optional</span></label><input id="places-area" value={area} maxLength={100}
        placeholder="e.g. Chicago, IL or Shibuya, Tokyo" autoComplete="off" disabled={!enabled || result.selecting || !!selected}
        onChange={e => result.setDraft({ area: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); result.submit(); } }}/>
        <p role="status">{area.trim() ? 'Your typed area takes priority over nearby location. You still choose the exact branch.' : locationMessage || 'Location is optional. Enter your full restaurant name, then search.'}</p></div>
      <RestaurantAutocomplete google explicitSearch persistentResults query={query} onQuery={value => result.setDraft({ query: value })} loading={result.loading}
        matches={(result.data?.predictions || []).map(p => ({ id: p.place_id, name: p.name, branch: '', address: p.address, cuisine: placeCategory(p.types), distance_km: p.distance_meters === null ? null : Math.round(p.distance_meters / 100) / 10 }))}
        error={result.error} retry={result.retry} onSubmit={result.submit} edited={result.edited}
        submittedLabel={!selected && !result.selectionError && result.submitted ? [result.submitted.query, result.submitted.area].filter(Boolean).join(' · ') : null}
        onSelect={match => result.select(match.id)} disabled={!enabled || result.selecting || !!selected}
        tools={<button className={'button ' + (location ? 'button-primary' : 'button-outline')} disabled={!enabled || locating || result.selecting || !!selected} onClick={requestLocation}>
          <Icon name="location" size={17}/>{locating ? 'Locating…' : location ? 'Nearby preference on ×' : 'Use my location'}</button>}/>
      {!selected && <button type="button" className="button button-primary places-submit" disabled={!enabled || query.trim().length < 3 || result.selecting || result.loading && !result.edited}
        onClick={result.submit}>{result.loading && !result.edited ? 'Searching restaurants…' : 'Search Restaurants'}<Icon name="arrow" size={16}/></button>}
      <p className="places-privacy">Search text and optional location are shared with Google when you search. <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></p>
    </section>
    {result.selecting && <div className="places-progress" role="status"><span className="rs-input-spinner"/> Confirming your branch with Google Maps…</div>}
    {result.selectionError && <div className="rs-empty" role="alert"><h2>This branch couldn’t be confirmed.</h2><p>{result.selectionError}</p><button className="button button-outline" onClick={result.retry}>Start a new search</button></div>}
    {selected ? <><section className="places-handoff" aria-labelledby="selected-place-name">
      <div className="places-identity"><Eyebrow>YOUR CHOSEN RESTAURANT</Eyebrow><h2 id="selected-place-name">{selected.restaurant.display_name}</h2>
        <p className="places-address"><Icon name="location" size={17}/>{selected.restaurant.formatted_address || 'Address unavailable'}</p>
        <span className="places-category">{placeCategory(selected.restaurant.types)}</span>
        {selected.restaurant.business_status !== 'OPERATIONAL' && <p className="places-business-status" role="status">{({ CLOSED_TEMPORARILY: 'Reported temporarily closed. Confirm with the restaurant before visiting.', CLOSED_PERMANENTLY: 'Reported permanently closed. Please choose another restaurant.', UNKNOWN: 'Business status unavailable. Confirm directly before visiting.' })[selected.restaurant.business_status]}</p>}
        <GoogleAttribution providers={selected.restaurant.attributions}/>
      </div>
      <div className="places-next"><Eyebrow>FROM THE RIGHT BRANCH</Eyebrow><h3>Menu sources. <br/><em>Then the dishes.</em></h3><p>Your branch identity comes from Google Places. Check the restaurant’s website below, choose its menu sources, and browse the dishes we can read. Personalized Picks remain unavailable until menu and safety evidence are verified.</p>
        <div className="places-actions"><button className="button button-outline" onClick={result.clear}>Change restaurant</button><button className="text-button" onClick={showDemo}>Try the separate demo menu journey <Icon name="arrow" size={15}/></button></div>
        <details className="places-source"><summary>Source &amp; available details</summary><p>Google Places API (New) · Retrieved {new Date(selected.restaurant.source.retrieved_at).toLocaleString()}</p><p>Place ID: <code>{selected.restaurant.place_id}</code></p>
          <ul>{selected.limitations.map(line => <li key={line}>{line}</li>)}</ul><p>This branch and its menu are backed up privately for your guest session for up to 24 hours. Expired signed proof allows browsing, not a new Google or model request.</p></details>
      </div>
    </section><MenuSourceDiscovery key={selected.restaurant.place_id + selected.source_discovery_token} handoff={selected}/></> : !result.selecting && <section className="places-intro"><span aria-hidden="true">01 — 02 — 03</span><h2>The right name.<br/><em>The right address.</em></h2><p>Find your restaurant, compare branches, and choose the place you have in mind. Then check its website for menu sources.</p></section>}
  </>;
}
