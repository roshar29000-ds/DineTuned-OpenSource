'use client';
import { useId } from 'react';
import type { BridgeComparison, BridgeFact, StructuredTasteBridge } from '../../lib/contracts';
import { bridgeBasisLabels, bridgeFallback, bridgeSourceLabels, readableTasteBridge } from '../../lib/tastebridge';
import { Icon } from '../UI';

function BridgeMark() {
  return <svg className="tb-mark" width="34" height="23" viewBox="0 0 34 23" fill="none" aria-hidden="true">
    <path d="M3 18C3 1 31 1 31 18M3 18H31M9 18V9M25 18V9" stroke="currentColor" strokeWidth="1.1"/>
    <circle cx="3" cy="18" r="2" fill="currentColor"/><circle cx="31" cy="18" r="2" fill="currentColor"/>
  </svg>;
}

function CitedComparison({ comparison, facts, prefix }: { comparison: BridgeComparison; facts: BridgeFact[]; prefix: string }) {
  return <li><p>{comparison.text}</p><span className="tb-citations">Sources: {[comparison.anchor_fact_id, comparison.target_fact_id].map(id => {
    const index = facts.findIndex(fact => fact.id === id);
    return <a key={id} href={`#${prefix}-source-${index}`} aria-label={`Source ${index + 1}: ${bridgeSourceLabels[facts[index].source]}`}>{index + 1}</a>;
  })}</span></li>;
}

/** All culinary copy is rendered verbatim from the validated comparison. */
export function TasteBridge({ bridge: raw, dishName }: { bridge: StructuredTasteBridge | null | undefined; dishName: string }) {
  const id = useId();
  const bridge = readableTasteBridge(raw);
  const available = bridge && bridge.status !== 'unavailable' && bridge.anchor;
  return <section className={'taste-bridge' + (available ? '' : ' tb-unavailable')} aria-labelledby={`${id}-title`} data-bridge-status={bridge?.status || 'unavailable'}>
    <header className="tb-heading"><div><BridgeMark/><h3 id={`${id}-title`}>TasteBridge</h3></div><span>DEMO COMPARISON</span></header>
    {available ? <>
      <div className="tb-journey">
        <div className="tb-origin"><span className="tb-kicker">{bridge.anchor!.kind === 'liked_dish' ? 'YOU ENJOYED' : 'YOUR STARTING POINT'}</span><p>{bridge.anchor!.label}</p></div>
        <span className="tb-connector" aria-hidden="true"><i/><span/><Icon name="arrow" size={18}/></span>
        <div className="tb-destination"><span className="tb-kicker">YOUR NEXT DISCOVERY</span><p>{dishName}</p></div>
      </div>
      <div className="tb-insight"><h4>What feels familiar</h4><p>{bridge.shared[0].text}</p></div>
      {bridge.differences.length > 0 && <div className="tb-difference"><h4>A new direction</h4><p>{bridge.differences[0].text}</p></div>}
      <p className="tb-scope">{bridge.status === 'limited' ? 'A partial connection, with room to learn more.' : 'Shared qualities, with a character of its own.'}</p>
      <details className="tb-details"><summary><span>Explore the connection<small>Comparison, sources & limits</small></span><Icon name="plus" size={18}/></summary>
        <div className="tb-details-body">
          <div className="tb-curator-note"><h4>The thread between them</h4><p>{bridge.explanation}</p></div>
          <h4>What’s shared</h4><ul className="tb-comparisons">{bridge.shared.map((comparison, i) => <CitedComparison key={i} comparison={comparison} facts={bridge.evidence} prefix={id}/>)}</ul>
          {bridge.differences.length > 0 && <><h4>Where they diverge</h4><ul className="tb-comparisons tb-contrasts">{bridge.differences.map((comparison, i) => <CitedComparison key={i} comparison={comparison} facts={bridge.evidence} prefix={id}/>)}</ul></>}
          <div className="tb-limits"><h4>Room for the unknown</h4><ul>{bridge.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul></div>
          <h4>Behind this connection</h4><ol className="tb-sources">{bridge.evidence.map((fact, i) => <li id={`${id}-source-${i}`} tabIndex={-1} key={fact.id}>
            <div><strong>{bridgeSourceLabels[fact.source]}</strong><span>{bridgeBasisLabels[fact.basis]}</span></div>
            <p>{fact.subject === 'target' ? dishName : fact.subject === 'familiar_dish' ? bridge.anchor!.label : 'Your preferences'} · {fact.label}</p>
            <small>{fact.reference}{fact.menu_version ? ` · ${fact.menu_version}` : ''}</small>
          </li>)}</ol>
        </div>
      </details>
    </> : <><p className="tb-fallback">{bridgeFallback(bridge?.unavailable_reason)}</p>
      {!!bridge?.uncertainties.length && <details className="tb-details"><summary><span>About this connection</span><Icon name="plus" size={18}/></summary><div className="tb-details-body tb-limits"><ul>{bridge.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul></div></details>}
    </>}
  </section>;
}
