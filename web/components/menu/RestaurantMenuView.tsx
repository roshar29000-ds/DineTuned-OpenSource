'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { DiningConstraints, MenuEvaluation, RestaurantMenu } from '../../lib/contracts';
import { useApi } from '../../lib/use-api';
import { eligibilityMap, evaluationMatchesMenu, visibleCategories } from '../../lib/menu';
import { hasAllergies, money } from '../../lib/preferences';
import { useDineTuned } from '../AppProvider';
import { Icon } from '../UI';
import { MenuItemCard } from './MenuItemCard';
import { MenuPicksAction, type PicksAvailability } from './MenuPicksAction';
import { MenuPreferences } from './MenuPreferences';

export function RestaurantMenuView({ data, retrievalNote }: { data: RestaurantMenu; retrievalNote?: ReactNode }) {
  const router = useRouter();
  const { constraints, setConstraints, selectMenu } = useDineTuned();
  const evaluation = useApi<MenuEvaluation>('menu/evaluate', 'MenuEvaluation', {
    restaurant_id: data.restaurant.id, menu_version: data.version, constraints,
  }, 180);
  const [query, setQuery] = useState('');
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [activeCategory, setActiveCategory] = useState('');
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const topAction = useRef<HTMLDivElement>(null);
  const [dockVisible, setDockVisible] = useState(false);
  useEffect(() => {
    if (!topAction.current) return;
    const observer = new IntersectionObserver(([entry]) => setDockVisible(!entry.isIntersecting), { rootMargin: '-80px 0px -66px 0px' });
    observer.observe(topAction.current);
    return () => observer.disconnect();
  }, []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const openFilters = () => {
    if (window.matchMedia('(max-width: 760px)').matches) setFiltersOpen(true);
    else document.querySelector<HTMLInputElement>('#menu-preferences input')?.focus();
  };
  useEffect(() => {
    if (!pendingCategory) return;
    const section = document.getElementById('category-' + pendingCategory);
    if (section) {
      section.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      section.focus({ preventScroll: true });
      setPendingCategory(null);
    }
  }, [pendingCategory, onlyMatches, query]);
  const r = data.restaurant;
  const mismatched = !!evaluation.data && !evaluationMatchesMenu(evaluation.data, data, constraints);
  const checked = mismatched ? null : evaluation.data;
  const checkError = evaluation.error || (mismatched ? new Error('The preference check does not match this menu and your current choices. Please retry.') : null);
  const categories = visibleCategories(data.categories, query, onlyMatches, checked);
  const eligibility = eligibilityMap(checked);
  const shownCount = categories.reduce((count, category) => count + category.items.length, 0);
  const total = data.total_items;
  const allergySelected = hasAllergies(constraints.allergies);
  const allergyCount = constraints.allergies.allergens.length + (constraints.allergies.other.trim() ? 1 : 0);
  const picks: PicksAvailability = { loading: evaluation.loading, unavailable: !!checkError, eligibleCount: checked?.eligible_count ?? null, candidateCount: checked?.recommendation_candidate_count ?? null, budget: constraints.max_price_minor };
  const updateHardFilters = (next: DiningConstraints) => { setConstraints(next); setOnlyMatches(true); };
  const showComplete = () => { setQuery(''); setOnlyMatches(false); setActiveCategory(''); };
  const getPicks = () => {
    if (!checked || evaluation.loading || checkError || checked.recommendation_candidate_count === 0) return;
    selectMenu({ restaurant_id: r.id, menu_version: data.version });
    // A deliberate demo request replays the same cinematic presentation using
    // this restaurant's menu. Returning to saved Picks does not replay it.
    if (sessionStorage.getItem('dinetuned-guided-demo-active') === '1') sessionStorage.setItem('dinetuned-demo-kitchen-pending', '1');
    router.push('/picks');
  };
  return <main className="smart-menu-page smart-menu-v3">
    <div className="content-width menu-breadcrumb"><Link href="/discover"><Icon name="left" size={15}/> Restaurants</Link>
      <span aria-hidden="true">/</span><span>{r.name}</span>
      <span className="journey-position"><span>01 Your taste</span><b>02 The menu</b><span>03 Your picks</span></span>
    </div>
    <section className="menu-masthead content-width">
      <div className="menu-masthead-copy"><span className="menu-edition">THE DINETUNED MENU EDIT · {r.cuisine.toUpperCase()}</span>
        <h1>{r.name}<span className="masthead-period">.</span></h1>
        <p>{r.subtitle}</p>
        <div className="venue-facts"><span><Icon name="location" size={16}/>{r.area}, {r.city}</span><span>{r.price_label}</span><span>{total} dishes to discover</span></div>
        <div className="fixture-label"><span className="status-dot"/> Fictional venue · complete sample menu</div>
      </div>
      <div className="menu-masthead-art" aria-hidden="true"><div className="menu-seal"><span>GOOD FOOD</span><Icon name="fork" size={40}/><span>YOUR WAY</span></div>
        <span className="masthead-script">A table for your taste.</span></div>
    </section>
    <section className="menu-top-invitation content-width" aria-label="Personal picks from this menu">
      <div><span className="section-kicker">THE WHOLE MENU. A LITTLE GUIDANCE.</span><h2>Explore freely. <em>Choose personally.</em></h2><p>Your Taste DNA and today’s preferences, brought to the table.</p></div>
      <div ref={topAction} className="menu-picks-top"><MenuPicksAction state={picks} onChoose={getPicks}/></div>
    </section>
    <div className="menu-retrieval-note">{retrievalNote}</div>
    <div className="content-width smart-menu-layout">
      <div className="menu-main">
        <div className="menu-section-heading"><div><span className="section-kicker">TAKE YOUR TIME. FOLLOW YOUR APPETITE.</span><h2>A menu of <em>possibilities.</em></h2></div>
          <span className="menu-total">{total} dishes / {data.categories.length} categories</span></div>
        <div className="menu-search-row"><div className="menu-search"><Icon name="search" size={18}/><input aria-label="Search this menu" placeholder="A dish, an ingredient, a craving…" value={query} maxLength={100} onChange={event => setQuery(event.target.value)}/>
          {query && <button aria-label="Clear menu search" onClick={() => setQuery('')}><Icon name="close" size={15}/></button>}</div></div>
        <div className="menu-view-tabs" role="group" aria-label="Menu view">
          <button aria-pressed={!onlyMatches} className={!onlyMatches ? 'active' : ''} onClick={showComplete}>Complete menu <span>{total}</span></button>
          <button aria-pressed={onlyMatches} className={onlyMatches ? 'active' : ''} onClick={() => setOnlyMatches(true)}>Matches my filters <span>{checked?.eligible_count ?? '…'}</span></button>
        </div>
        <div className="menu-browse-toolbar"><button className="menu-filter-trigger" onClick={openFilters} aria-label="Open budget and preferences"><Icon name="adjust" size={17}/><span>Filters</span><b>{money(constraints.max_price_minor)}</b></button>
        <nav className="menu-category-nav" aria-label="Menu categories">
          {data.categories.map(category => <a key={category.id} href={'#category-'+category.id} aria-current={activeCategory === category.id ? 'location' : undefined}
            onClick={event => {
              event.preventDefault();
              if (!categories.some(c => c.id === category.id)) { setQuery(''); setOnlyMatches(false); }
              setActiveCategory(category.id);
              setPendingCategory(category.id);
            }}>
            {category.name}<span>{category.items.length}</span>
          </a>)}
        </nav>
        </div>
        <div className="menu-applied-summary"><span>{money(constraints.max_price_minor)} max / dish</span><span>{constraints.dietary_restrictions.length ? `${constraints.dietary_restrictions.length} dietary ${constraints.dietary_restrictions.length === 1 ? 'preference' : 'preferences'}` : 'All dietary styles'}</span>
          {allergyCount > 0 && <span className="menu-allergy-summary"><Icon name="shield" size={12}/>{allergyCount} allergy {allergyCount === 1 ? 'concern' : 'concerns'}</span>}
          <Link href="/taste">Taste DNA <Icon name="arrow" size={12}/></Link></div>
        <div className="menu-results-note" role="status" aria-live="polite">
          {evaluation.loading ? 'Checking your preferences…' : checkError ? 'Preference checks are unavailable.' : `${shownCount} of ${total} dishes shown · ${checked?.eligible_count ?? 0} match your filters`}
          {(onlyMatches || query) && <button onClick={showComplete}>Show complete menu</button>}
        </div>
        {allergySelected && <div className="allergy-menu-notice"><Icon name="shield" size={20}/><div><strong>Restaurant confirmation is needed.</strong><p>This sample menu has incomplete allergen and cross-contact information. Uncertain dishes are excluded from your picks. You can still browse every dish.</p></div></div>}
        {checkError && <div className="inline-error" role="alert"><p>{checkError.message} Your filters have not been removed.</p><button onClick={evaluation.retry} className="text-button">Retry preference check</button></div>}
        {onlyMatches && evaluation.loading ? <div className="menu-checking" role="status"><span className="rs-input-spinner"/> Checking the full menu against your preferences…</div> : categories.length === 0 ?
          <div className="menu-empty"><Icon name={allergySelected ? 'shield' : 'search'} size={30}/><h3>{checkError ? 'Your menu is still here.' : query ? 'No dishes match this search.' : 'Nothing fits every filter yet.'}</h3>
            <p>{checkError ? 'We can’t confirm filter matches right now. Browse all dishes while the preference check is unavailable.'
              : allergySelected ? 'We cannot establish allergy suitability from this sample menu. Browse the complete menu and ask restaurant staff about your requirements.'
                : query ? 'Try another dish or ingredient, or return to the complete menu. Your preferences will stay saved.'
                  : `No dish meets all of your current requirements at ${money(constraints.max_price_minor)} or less. Review your preferences, or browse everything without changing them.`}</p>
            <div className="menu-empty-actions"><button className="button button-outline" onClick={showComplete}>Browse the complete menu</button><button className="text-button" onClick={openFilters}>Review preferences</button></div></div>
          : categories.map(category => <section id={'category-'+category.id} className="menu-category-section" key={category.id} tabIndex={-1}>
            <div className="category-heading"><div><h2>{category.name}</h2><p>{category.description}</p></div><span>{category.items.length.toString().padStart(2, '0')}</span></div>
            <div className="smart-dish-grid">{category.items.map((item, index) => <MenuItemCard key={item.id} item={item} index={index} eligibility={eligibility.get(item.id)} checksUnavailable={!!checkError}/>)}</div>
          </section>)}
        <div className="menu-source-note"><Icon name="book" size={19}/><div><strong>{data.source.label}</strong><p>{data.source.note} Prices, ingredients, and illustrations are examples.</p></div></div>
        <section className="menu-next-step">
          <div><span className="section-kicker">FROM THE MENU TO YOUR MOMENT</span><h2>Ready for a little <em>guidance?</em></h2><p>Up to three strong taste matches. Picks prioritize your budget, with clearly labeled above-budget alternatives when needed. Dietary and allergy safeguards stay firm.</p></div>
          <MenuPicksAction state={picks} onChoose={getPicks} secondary/>
        </section>
      </div>
      <MenuPreferences value={constraints} onChange={setConstraints} onHardChange={updateHardFilters} open={filtersOpen} onClose={closeFilters} eligibleCount={checked?.eligible_count ?? null} checksUnavailable={!!checkError}/>
    </div>
    <div className="menu-mobile-dock" data-visible={dockVisible} role="region" aria-label="Personal picks and preferences">
      <button className="menu-dock-filters" onClick={openFilters} aria-label="Open budget and preferences"><Icon name="adjust" size={20}/><span>Filters</span></button>
      <MenuPicksAction state={picks} onChoose={getPicks}/>
    </div>
  </main>;
}
