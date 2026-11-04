'use client';
import { useEffect, useRef } from 'react';
import type { ExtractedMenuItem, ExtractedPrice, MenuExtractionResult } from '../../lib/contracts';
import { printedAmount, sourcePage } from '../../lib/menu-retrieval/extracted-presentation';
import { Eyebrow, Icon } from '../UI';
import { RealMenuPicks } from './RealMenuPicks';

function MenuPrice({ price }: { price: ExtractedPrice }) {
  if (price.kind === 'unknown' || price.kind === 'ambiguous' || !price.options.length) return <div className="real-menu-price">
    <strong>{price.raw || 'Price not listed'}</strong><span>Price unconfirmed</span></div>;
  return <div className="real-menu-price">
    {price.kind === 'range' ? <><strong>{price.options.map(printedAmount).join(' – ')}</strong><span>Listed price range</span></>
      : price.options.map((option, i) => <div key={i}>{option.label && <span>{option.label}</span>}<strong>{printedAmount(option)}</strong></div>)}
    {price.kind === 'variants' && <span>Listed options · no size selected</span>}
    {price.kind === 'fixed' && !price.budget_usable && <span>Price needs review</span>}
  </div>;
}

export function RealRestaurantMenu({ result, reviewSources, preview = false }: { result: MenuExtractionResult; reviewSources: () => void; preview?: boolean }) {
  const { menu } = result;
  const uploaded = menu.sources.some(source => source.candidate.provenance === 'user_upload');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); if (!preview) heading.current?.scrollIntoView({ block: 'start' }); }, [result.request_id, preview]);
  const evidence = new Map(menu.evidence.map(value => [value.id, value]));
  function itemNotes(item: ExtractedMenuItem) {
    return <details className="real-item-notes"><summary>Source &amp; item notes</summary>
      <p>{({ structured: 'Transcribed from structured menu data.', supported: 'Text matched to source evidence.', needs_review: 'This record needs review against the source.' })[item.confidence]}</p>
      <ul>{[...new Set([...item.limitations, ...item.price.limitations])].map(line => <li key={line}>{line}</li>)}</ul>
      {item.price.raw && <p>Price as printed: <span>{item.price.raw}</span></p>}
      {item.evidence_ids.map(id => evidence.get(id)).filter(value => !!value).map(value => <div className="real-item-evidence" key={value.id}>
        {preview ? <span>Fictional fixture evidence · no restaurant source</span> : uploaded ? <span>Uploaded document evidence{value.page ? ` · page ${value.page}` : ''}</span>
          : <a href={sourcePage(value.source_url, value.page)} target="_blank" rel="noopener noreferrer">View source{value.page ? ` · page ${value.page}` : ''} <Icon name="arrow" size={13}/></a>}
        <blockquote>{value.quote}</blockquote></div>)}
    </details>;
  }
  return <section className="real-menu" aria-label="Extracted restaurant menu">
    <header className="real-menu-heading"><div><Eyebrow>{preview ? 'FROM A FICTIONAL DEMO MENU' : uploaded ? 'FROM YOUR UPLOADED DOCUMENT' : 'FROM THE RESTAURANT’S MENU'}</Eyebrow>
      <h2 ref={heading} tabIndex={-1}>On the menu.<br/><em>{menu.restaurant.display_name}</em></h2>
      <p>{menu.restaurant.formatted_address || 'Branch address unavailable'}</p></div>
      <div className="real-menu-count"><strong>{menu.total_items}</strong><span>items transcribed<br/>from {menu.sources.length} selected {menu.sources.length === 1 ? 'source' : 'sources'}</span></div>
    </header>
    <div className="real-menu-notice" role="status"><strong>{preview ? 'A complete fictional sample, for exploring the experience.' : result.status === 'needs_review' ? 'A useful view, with details still to verify.' : 'The source text, brought to your table.'}</strong>
      <p>{preview ? 'These dish names, descriptions and prices belong to a local demonstration fixture. They do not represent a real restaurant or an actual menu.' : 'All recovered items are shown below. This is not a guarantee of the restaurant’s entire or current menu. Prices are shown as printed; availability, tax and fees may differ.'}</p>
      {uploaded && <p>This file was supplied by you. Its official origin and connection to this branch have not been independently verified. Confirm dishes, prices and restrictions with staff.</p>}
      {result.vision_status !== 'not_needed' && <p>Some pages need image reading and are missing from this view. Scanned-menu extraction is not connected.</p>}
      {!preview && <button className="text-button" onClick={reviewSources}>{uploaded ? 'Choose another file' : 'Review or change menu sources'} <Icon name="arrow" size={14}/></button>}</div>
    {!preview && <details className="real-menu-verification"><summary>Sources &amp; verification · {menu.issues.length} {menu.issues.length === 1 ? 'note' : 'notes'}</summary>
      <p>Extracted {new Date(menu.extracted_at).toLocaleString()}. A retrieval timestamp does not establish menu freshness.</p>
      {menu.sources.map(source => <article key={source.id}><h3>{source.candidate.title}</h3>
        {source.candidate.provenance === 'user_upload' ? <p>User-supplied document · no public source URL verified</p>
          : <a href={source.source_url} target="_blank" rel="noopener noreferrer">{source.source_url}</a>}
        <p>{source.status.replaceAll('_', ' ')} · {source.candidate.format.toUpperCase()} · {source.extracted_items} records recovered{source.page_count ? ` · ${source.parsed_pages.length}/${source.page_count} pages with text` : ''}</p>
        <p>{source.candidate.date_label ? `Source date label: ${source.candidate.date_label}. ` : ''}Freshness unconfirmed. {source.retrieved_at ? `Retrieved ${new Date(source.retrieved_at).toLocaleString()}.` : 'Document not retrieved.'}</p>
        <p>Branch evidence: {source.candidate.branch_relevance.replaceAll('_', ' ')} · {source.candidate.confidence} source confidence.</p>
        <details><summary>Original discovery notes · before extraction</summary><ul>{source.candidate.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul></details>
        {source.source_hash && <p className="real-menu-trace">Document SHA-256: <code>{source.source_hash}</code></p>}
      </article>)}
      <ul>{menu.completeness.reasons.map(line => <li key={line}>{line}</li>)}{menu.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
      <p className="real-menu-trace">Menu version: <code>{menu.version}</code> · Parser: {menu.parser_version}. HTML / text-PDF extraction; no AI processing.</p>
    </details>}
    <nav className="real-menu-nav" aria-label="Extracted menu categories">{menu.categories.map(category =>
      <a key={category.id} href={`#real-${category.id}`}>{category.name}<span>{category.items.length}</span></a>)}</nav>
    {menu.categories.map((category, index) => <section key={category.id} id={`real-${category.id}`} className="real-menu-category" aria-labelledby={`heading-${category.id}`}>
      <div className="real-menu-category-heading"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h3 id={`heading-${category.id}`}>{category.name}</h3><span>{category.items.length} items</span></div>
      <div className="real-menu-items">{category.items.map(item => <article key={item.id} className="real-menu-item" aria-labelledby={`name-${item.id}`}>
        <div className="real-menu-item-top"><h4 id={`name-${item.id}`}>{item.name}</h4><MenuPrice price={item.price}/></div>
        <p className={!item.description ? 'real-menu-unknown' : ''}>{item.description || 'No description was extracted.'}</p>
        {item.availability === 'listed_unavailable' && <span className="real-menu-flag">Listed unavailable</span>}
        {item.confidence === 'needs_review' && <span className="real-menu-flag">Source review needed</span>}
        {itemNotes(item)}
      </article>)}</div>
    </section>)}
    {!preview && <RealMenuPicks key={result.request_id} extraction={result}/>}
  </section>;
}
