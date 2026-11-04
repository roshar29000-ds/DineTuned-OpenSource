import Link from 'next/link';
import type { RestaurantMatch } from '../../lib/restaurants/search';
import { retrievalStages, type RetrievalProgress as Progress } from '../../lib/menu-retrieval/provider';
import { Icon } from '../UI';

export function RetrievalProgress({ progress, hint }: { progress: Progress; hint: RestaurantMatch | null }) {
  const index = retrievalStages.findIndex(stage => stage.id === progress.stage);
  const menu = progress.menu, restaurant = menu?.restaurant || hint;
  return <main className="mr-page mr-progress-polish content-width page-padding" aria-busy="true">
    <Link className="back-link" href="/discover"><Icon name="left" size={15}/> Back to restaurants</Link>
    <div className="mr-loading-layout"><section className="mr-loading-copy"><div className="mr-loading-flourish" aria-hidden="true"><Icon name="fork" size={25}/><span/></div><span className="rs-overline">THE MENU, COMING INTO FOCUS</span><h1>A little closer<br/>to <em>delicious.</em></h1>
      <p>{restaurant ? <><strong>{restaurant.name}</strong> · {restaurant.area}<br/></> : null}Opening the available demo menu. Your taste and preferences are already at the table.</p>
      <ol className="mr-stages" aria-label="Menu preparation stages">{retrievalStages.map((stage, i) => <li key={stage.id} className={i < index ? 'complete' : i === index ? 'current' : ''} aria-current={i === index ? 'step' : undefined}>
        <span className="mr-stage-number">{i < index ? <Icon name="check" size={16}/> : String(i + 1).padStart(2, '0')}</span><div><strong>{stage.label}</strong><p>{stage.detail}</p></div>{i === index && <span className="rs-input-spinner"/>}</li>)}</ol>
      <p className="mr-stage-announcement" role="status">{retrievalStages[index].label} · demo data only</p>
      <p className="mr-truth"><Icon name="info" size={16}/> Demo menu preparation. No external website is being retrieved. No AI extraction is taking place.</p></section>
      <aside className="mr-menu-portrait"><div className="mr-paper"><span className="mr-paper-edition">THE DINETUNED MENU EDIT</span><Icon name="fork" size={30}/><h2>{restaurant?.name || 'A table for your taste.'}</h2>
        <span className="mr-paper-rule"/>{menu ? <div className="mr-preview-items">{menu.categories.slice(0, 3).map(category => <div key={category.id}><strong>{category.name}</strong><p>{category.items.slice(0, 2).map(item => item.name).join(' · ')}</p></div>)}</div>
          : <><div className="mr-paper-lines" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div><p>{hint ? `${hint.item_count} dishes listed in the demo directory. Waiting for the menu response.` : 'Waiting for this branch’s menu response.'}</p></>}
        <span className="mr-paper-foot">CURATED DEMO · NOT A LIVE RESTAURANT MENU</span></div><span className="mr-portrait-note">The whole menu. All the possibilities.</span></aside></div>
  </main>;
}
