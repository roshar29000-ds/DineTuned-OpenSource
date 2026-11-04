'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MediaAsset, DiscoveryConfig } from '../../lib/contracts';
import { apiRequest } from '../../lib/api';
import { useRestaurantSearch } from '../../lib/restaurants/use-restaurant-search';
import type { SearchLocation } from '../../lib/restaurants/search';
import { DishArt } from '../DishArt';
import { Eyebrow, Icon } from '../UI';
import { RestaurantAutocomplete } from './RestaurantAutocomplete';
import { PlacesSearch } from './PlacesSearch';
import { useIdentity } from '../IdentityProvider';
import { DEMO_SESSION_KEY, leaveDemoExplore } from '../../lib/demo-session';

const cuisines = ['All', 'Vietnamese', 'Mexican', 'Italian', 'Japanese', 'Indian', 'Mediterranean'];
const motifFor = (cuisine: string): MediaAsset['motif'] => ({ Vietnamese: 'noodles', Mexican: 'tacos', Italian: 'pasta', Japanese: 'bowl', Indian: 'curry', Mediterranean: 'plate' } as Record<string, MediaAsset['motif']>)[cuisine] || 'plate';

export function RestaurantSearchView() {
  const router = useRouter();
  const identity = useIdentity().state;
  const [config, setConfig] = useState<DiscoveryConfig | null>(null);
  const [mode, setMode] = useState<'demo' | 'google_places' | null>(null);
  const google = (mode || (identity.status === 'local' ? 'demo' : 'google_places')) === 'google_places';
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<DiscoveryConfig>('discovery/config', 'DiscoveryConfig', undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setConfig(value);
    }).catch(() => {
      if (!controller.signal.aborted) setConfig({ google_enabled: false, minimum_query_length: 3, message: 'Real restaurant search status is unavailable. The fictional demo remains available.' });
    });
    return () => controller.abort();
  }, []);
  const [query, setQuery] = useState(''), [cuisine, setCuisine] = useState('All');
  const [location, setLocation] = useState<SearchLocation | null>(null);
  const [locationMessage, setLocationMessage] = useState(''), [locating, setLocating] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const result = useRestaurantSearch({ query, cuisine, location });
  const directory = query || location ? result.matches : result.matches.filter((restaurant, index, all) => all.findIndex(other => other.name === restaurant.name) === index);
  function requestLocation() {
    if (!navigator.geolocation) { setLocationMessage('Location is unavailable. Search by name or neighborhood instead.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationMessage('Matching fictional branches are sorted by distance. You still choose the restaurant.'); setLocating(false);
    }, () => {
      if (!mounted.current) return;
      setLocationMessage('Location wasn’t shared. Search by name or neighborhood; your choices are still here.'); setLocating(false);
    }, { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false });
  }
  return <main className="rs-page content-width page-padding">
    <header className="rs-hero"><div><Eyebrow>A PLACE. A MENU. A LITTLE POSSIBILITY.</Eyebrow><h1>Where shall we<br/><em>set your table?</em></h1><p>Your taste is personal. Start with a restaurant you have in mind.<br/>{google ? 'Choose the name. Confirm the address. Make it your evening.' : 'Explore a complete fictional menu, then discover your picks.'}</p></div>
      <div className="rs-table-note" aria-hidden="true"><div className="rs-plate"><span>YOUR NEXT<br/>FAVORITE</span><Icon name="fork" size={31}/></div><span className="rs-script">Good things start<br/>at the table.</span><small>THE DINETUNED FIELD GUIDE</small></div></header>
    <div className="guided-demo-entry"><Link href="/demo" className="button button-primary">Try DineTuned Demo <Icon name="arrow" size={16}/></Link><span>See the Meta Muse-powered workflow with fictional sample results · no Google or Meta calls</span></div>
    <div className="places-modes" role="group" aria-label="Restaurant search source"><button aria-pressed={google} onClick={() => sessionStorage.getItem(DEMO_SESSION_KEY) === '1' ? leaveDemoExplore() : setMode('google_places')}>Real restaurants <span>{config?.google_enabled ? 'Google Places' : 'Live search paused'}</span></button>
      <button aria-pressed={!google} onClick={() => setMode('demo')}>Fictional demo <span>Complete menu &amp; picks</span></button></div>
    {google ? <PlacesSearch enabled={config?.google_enabled || false} message={config?.message || 'Checking restaurant search availability…'} showDemo={() => setMode('demo')}/> : <>
    <section className="rs-search-panel" aria-label="Find a restaurant"><div className="rs-search-row"><RestaurantAutocomplete query={query} onQuery={value => { setMode('demo'); setQuery(value); }}
      matches={result.matches} loading={result.loading} error={result.error} retry={result.retry} onSelect={match => router.push('/restaurant/' + encodeURIComponent(match.id))}
      tools={<button className={'button ' + (location ? 'button-primary' : 'button-outline')} disabled={locating} onClick={() => location
        ? (setLocation(null), setLocationMessage('Nearby sorting removed.')) : requestLocation()}><Icon name="location" size={17}/>{locating ? 'Locating…' : location ? 'Nearby sorting on ×' : 'Use my location'}</button>}/></div>
      <div className="rs-search-caption"><span role="status">{locationMessage || 'Location is optional. We never detect or choose a restaurant for you.'}</span><span className="rs-demo-label">FICTIONAL DEMO DIRECTORY</span></div>
    </section>
    <div className="rs-journey" aria-label="Your dining journey"><span><b>01</b> Choose a restaurant</span><Icon name="arrow" size={15}/><span><b>02</b> Explore the full menu</span><Icon name="arrow" size={15}/><span><b>03</b> Find your personal picks</span></div>
    <section className="rs-directory"><div className="rs-section-heading"><div><Eyebrow>A FEW PLACES TO BEGIN</Eyebrow><h2>{query ? <>Find your <em>table.</em></> : <>Different kitchens. <em>Your taste.</em></>}</h2></div>
      <span role="status">{result.loading ? 'Searching…' : `${directory.length} sample restaurants`}</span></div>
      <div className="filter-scroller rs-cuisines" role="group" aria-label="Cuisine filter">{cuisines.map(value => <button key={value} type="button" className={'filter-chip ' + (cuisine === value ? 'active' : '')}
        aria-pressed={cuisine === value} onClick={() => setCuisine(value)}>{value}</button>)}</div>
      {result.loading ? <div className="rs-directory-loading" role="status"><span className="rs-input-spinner"/> Finding matching restaurants…</div>
        : result.error ? <div className="rs-empty" role="alert"><Icon name="search" size={28}/><h3>A small pause in the search.</h3><p>{result.error}</p><button className="button button-outline" onClick={result.retry}>Try again</button></div>
        : directory.length ? <div className="restaurant-grid rs-cards">{directory.map((restaurant, index) => <Link href={'/restaurant/' + restaurant.id} className="restaurant-card rs-card" key={restaurant.id}
          aria-label={`Open the full menu at ${restaurant.name}, ${restaurant.branch}`}><div className="rs-card-art"><DishArt name={restaurant.cuisine + ' cuisine'} seed={restaurant.id}
            media={{ kind: 'placeholder', motif: motifFor(restaurant.cuisine), accent: restaurant.accent, label: 'Illustrated placeholder' }}/><span className="rs-card-number">{String(index + 1).padStart(2, '0')}</span></div>
          <div className="rs-card-copy"><div className="rs-card-eyebrow"><span>{restaurant.cuisine}</span><span>{restaurant.price_label}</span></div><h3>{restaurant.name}<Icon name="arrow" size={18}/></h3>
            <span className="rs-branch"><Icon name="location" size={13}/>{restaurant.branch} branch</span><p>{restaurant.subtitle}</p><div className="rs-address">Demo address · {restaurant.address || 'Unavailable'}</div>
            <div className="rs-card-footer"><span>{restaurant.item_count} sample dishes</span><span>{restaurant.distance_km !== null ? `${restaurant.distance_km} km · example location` : 'View the full menu'}</span></div></div></Link>)}</div>
        : <div className="rs-empty"><Icon name="search" size={28}/><h3>No matching sample venues.</h3><p>Try Saigon Table, another cuisine, or a neighborhood. Real restaurant search is available separately when configured.</p>
          <button className="button button-outline" onClick={() => { setQuery(''); setCuisine('All'); }}>Show all sample locations</button></div>}
    </section>
    <footer className="rs-search-foot"><Icon name="book" size={22}/><div><strong>A little context before we begin.</strong><p>These restaurants, addresses, and menus are fictional examples from our demo directory. Real restaurant search, source-based menu extraction and approved real-menu Picks are a separate experience.</p></div><span>YOUR TASTE → THE WHOLE MENU</span></footer>
    </>}
  </main>;
}
