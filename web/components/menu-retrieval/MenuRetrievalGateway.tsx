'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDineTuned } from '../AppProvider';
import { ApiError } from '../../lib/api';
import { restaurantHint } from '../../lib/restaurants/search';
import { recoveryCopy, type MenuQuality } from '../../lib/menu-retrieval/quality';
import { useMenuRetrieval } from '../../lib/menu-retrieval/use-menu-retrieval';
import { retrievalStages, type MenuRetrievalResult } from '../../lib/menu-retrieval/provider';
import { Icon } from '../UI';
import { RestaurantMenuView } from '../menu/RestaurantMenuView';
import { MenuSourceFallback } from './MenuSourceFallback';
import { RetrievalProgress } from './RetrievalProgress';

type Recovery = Exclude<MenuQuality, 'ready'>;
function RetrievalReceipt({ result, preview }: { result: MenuRetrievalResult; preview: (status: Recovery) => void }) {
  return <details className="mr-receipt content-width" aria-label="Menu retrieval checks"><summary><span className="mr-receipt-check"><Icon name="check" size={14}/></span><span><strong>Sample menu ready</strong><small>{result.menu.total_items} dishes · all available categories · demo data</small></span><span>View checks <Icon name="chevron" size={13}/></span></summary>
    <div className="mr-receipt-body"><div className="mr-completed-stages">{retrievalStages.map(stage => <span key={stage.id}><Icon name="check" size={13}/>{stage.label}</span>)}</div>
      <p>These checks cover the saved sample menu. No restaurant website was retrieved and no AI extraction took place.</p>
      <dl className="mr-evidence">{result.assessment.checks.map(check => <div key={check.id}><dt>{check.label}<span>{check.result === 'not_applicable' ? 'Not applicable' : 'Checked'}</span></dt><dd>{check.detail}</dd></div>)}</dl>
      <div className="mr-category-preview"><span className="rs-overline">FROM THE AVAILABLE SAMPLE · IN MENU ORDER</span><div>{result.preview.map((category, index) => <section key={index}><h3>{category.category}<span>{category.itemCount} dishes</span></h3><p>{category.dishes.join(' · ')}</p></section>)}</div></div>
      <p className="mr-truth"><Icon name="shield" size={16}/> These checks do not verify ingredients, allergens, or cross-contact safety. Your existing allergy exclusions still apply.</p>
      <details className="mr-demo-scenarios"><summary>Preview menu recovery states <span>INTERFACE DEMO</span></summary><p>These explicitly simulated states leave the real sample menu and your preferences unchanged.</p><div>{(['missing', 'incomplete', 'outdated', 'unreliable'] as Recovery[]).map(status => <button key={status} className="button button-outline" onClick={() => preview(status)}>Preview {status} menu</button>)}</div></details>
      <details className="mr-source-disclosure"><summary>Have another menu source?</summary><MenuSourceFallback/></details>
    </div>
  </details>;
}
export function MenuRetrievalGateway({ restaurantId }: { restaurantId: string }) {
  const retrieval = useMenuRetrieval(restaurantId);
  const { selection, clearSelection } = useDineTuned();
  useEffect(() => {
    if (selection && (selection.restaurant_id !== restaurantId || (retrieval.result && selection.menu_version !== retrieval.result.menu.version))) clearSelection();
  }, [restaurantId, retrieval.result, selection, clearSelection]);
  const [scenario, setScenario] = useState<Recovery | null>(null);
  if (retrieval.loading) return <RetrievalProgress progress={retrieval.progress} hint={restaurantHint(restaurantId)}/>;
  const result = retrieval.result;
  if (result?.assessment.status === 'ready' && !scenario) return <div className="mr-menu-arrival"><RestaurantMenuView data={result.menu}
    retrievalNote={<RetrievalReceipt result={result} preview={status => { setScenario(status); window.scrollTo({ top: 0, behavior: 'instant' }); }}/>}/></div>;
  const status: Recovery = scenario || (result && result.assessment.status !== 'ready' ? result.assessment.status : retrieval.error instanceof ApiError && retrieval.error.status === 404 ? 'missing' : 'unreliable');
  const copy = recoveryCopy[status];
  const venue = result?.menu.restaurant.id === restaurantId ? result.menu.restaurant : restaurantHint(restaurantId);
  return <main className="mr-page mr-recovery-page content-width page-padding">
    <Link className="back-link" href="/discover"><Icon name="left" size={15}/> Back to restaurants</Link>
    <div className="mr-recovery-layout"><section className="mr-recovery" aria-label="Menu availability"><div className="mr-recovery-symbol"><Icon name={status === 'outdated' ? 'clock' : status === 'missing' ? 'book' : 'shield'} size={35}/></div>
      <span className="rs-overline">{scenario ? 'SIMULATED RECOVERY STATE · INTERFACE PREVIEW' : 'A LITTLE CARE BEFORE WE CONTINUE'}</span>
      <h1>{copy.title}</h1>{venue && <div className="mr-venue-line">{venue.name} · {venue.area} branch</div>}<p>{copy.description}</p>
      {scenario ? <p className="mr-simulation-note">This is a <strong>{scenario}</strong> state preview. Your available demo menu has not changed. No extraction or external checks have been performed.</p>
        : retrieval.error ? <p role="alert" className="mr-failure-reason">{retrieval.error.message}</p>
          : <ul className="mr-failure-reasons">{result?.assessment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <div className="mr-recovery-actions">{scenario ? <button className="button button-primary" onClick={() => setScenario(null)}>Return to available sample menu <Icon name="arrow" size={16}/></button>
        : <button className="button button-primary" onClick={retrieval.retry}>Try again <Icon name="reset" size={16}/></button>}<Link href="/discover" className="button button-outline">Choose another restaurant</Link></div>
      <span className="mr-preferences-kept"><Icon name="check" size={14}/> Your Taste DNA, budget, dietary restrictions, allergies, and cravings are preserved.</span>
    </section>
    <MenuSourceFallback/></div>
  </main>;
}
