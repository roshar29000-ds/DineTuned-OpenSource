'use client';
import { useState } from 'react';
import { useDiningMemory } from './DiningMemoryProvider';
import { useDineTuned } from '../AppProvider';
import { ButtonLink, Icon } from '../UI';
import type { DiningEventWrite, DishFeedbackWrite, MealFeedback } from '../../lib/contracts';
import { eventLabels, feedbackTags, recordRevision, type Entry, type EventValue, type FeedbackValue } from '../../lib/memory/journal';

function DiaryRecord({ entry, kind }: { entry: Entry<EventValue> | Entry<FeedbackValue>; kind: 'events' | 'feedback' }) {
  const { store, data } = useDiningMemory(), local = useDineTuned();
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const event = kind === 'events' ? entry.value as EventValue : null;
  const rating = kind === 'feedback' ? entry.value as FeedbackValue : null;
  const [eventType, setEventType] = useState<DiningEventWrite['event_type']>(event?.event_type || 'saved');
  const [note, setNote] = useState(rating?.feedback.note || ''), [liked, setLiked] = useState(rating?.feedback.liked ?? true);
  const [stars, setStars] = useState<number | null>(rating?.rating ?? null), [tags, setTags] = useState<DishFeedbackWrite['tags']>(rating?.tags || []);
  const dish = event?.dish_name || rating?.feedback.dish_name || event?.dish_id || 'Recorded dish';
  const restaurant = event?.restaurant_name || rating?.feedback.restaurant_name || event?.restaurant_id;
  const date = event?.occurred_at || rating!.feedback.date;
  async function operate(remove: boolean) {
    if (!store || busy) return;
    setBusy(true); setError('');
    try {
      if (remove) { await store.remove(kind, entry); if (rating) local.removeFeedback(rating.feedback.id); }
      else if (event) await store.correct('events', entry as Entry<EventValue>, { expected_revision: recordRevision(event), event_type: eventType });
      else if (rating) {
        await store.correct('feedback', entry as Entry<FeedbackValue>, { expected_revision: recordRevision(rating), liked, note, rating: stars, tags });
        local.correctFeedback({ ...rating.feedback, liked, note });
      }
      setEditing(false); setDeleting(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This change could not be confirmed.'); }
    finally { setBusy(false); }
  }
  return <article className="memory-item dining-record" data-record-id={entry.value.id}>
    <div className="memory-stamp" aria-hidden="true"><Icon name={rating ? 'heart' : 'fork'} size={24}/></div>
    <div className="memory-item-main"><span className="memory-item-date">{new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {event ? eventLabels[event.event_type] : 'Rated'}</span>
      <h3>{dish}</h3><p>{restaurant}</p>
      {rating && <><p>{rating.feedback.liked ? 'Loved it' : 'Not for me'}{rating.rating ? ` · ${rating.rating} / 5` : ''}</p>
        {rating.feedback.note && <blockquote>“{rating.feedback.note}”</blockquote>}
        <p>{rating.tags.map(tag => feedbackTags[tag]).join(' · ')}</p>
        {!data.events.some(item => item.value.id === rating.event_id && item.value.event_type === 'tasted') && <small>Consumption is not explicitly confirmed by a linked tried-dish record.</small>}</>}
      <small className="dining-storage">{entry.status === 'synced' ? 'Private cloud record' : entry.status === 'pending' ? 'Saved locally · cloud save pending' : 'Saved in this browser only'}</small>
      <details className="dining-provenance"><summary>Original context</summary><p>Restaurant: {event?.restaurant_id || rating?.feedback.restaurant_id || 'Not recorded'} · Menu: {event?.menu_version || rating?.feedback.menu_version || 'Not recorded'} · Dish: {event?.dish_id || rating?.feedback.dish_id}</p>
        <p>{event?.recommendation_id ? `Recommendation record: ${event.recommendation_id}` : rating?.event_id ? 'Linked to an explicit dining event.' : 'No linked recommendation record.'} User-reported; no AI interpretation.</p></details>
      {!editing && !deleting && <div className="dining-record-actions"><button disabled={busy || !store} onClick={() => setEditing(true)}>Correct record</button><button disabled={busy || !store} onClick={() => setDeleting(true)}>Delete record</button></div>}
      {editing && <form className="dining-editor" onSubmit={e => { e.preventDefault(); void operate(false); }}>
        {event ? <label>Correct dining action<select value={eventType} onChange={e => setEventType(e.target.value as DiningEventWrite['event_type'])}>
          {Object.entries(eventLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <>
          <label>Your experience<select value={liked ? 'yes' : 'no'} onChange={e => setLiked(e.target.value === 'yes')}><option value="yes">Loved it</option><option value="no">Not for me</option></select></label>
          <label>Rating<select value={stars ?? ''} onChange={e => setStars(e.target.value ? Number(e.target.value) : null)}><option value="">No star rating</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n} / 5</option>)}</select></label>
          <label>Your original observations<textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label>
          <div className="dining-tags">{Object.entries(feedbackTags).map(([key,label]) => { const tag = key as DishFeedbackWrite['tags'][number];
            return <button key={key} type="button" aria-pressed={tags.includes(tag)} onClick={() => setTags(previous => previous.includes(tag) ? previous.filter(t => t !== tag) : [...previous,tag])}>{label}</button>; })}</div>
        </>}
        <p>Correcting this record does not change the original restaurant, dish, or menu version.</p>
        <button type="submit" disabled={busy}>Save correction</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel correction</button>
      </form>}
      {deleting && <div className="memory-confirm"><p>Delete this {event ? eventLabels[event.event_type].toLowerCase() + ' event' : 'rating and feedback'}? This removes the record{entry.status === 'synced' ? ' from your cloud history and this browser' : ' from this browser'}. Your Taste DNA backup is unchanged.</p>
        <button disabled={busy} onClick={() => operate(true)}>Confirm delete</button><button disabled={busy} onClick={() => setDeleting(false)}>Cancel deletion</button></div>}
      {error && <p role="alert">{error}</p>}
    </div>
  </article>;
}
function LegacyRecord({ item }: { item: MealFeedback }) {
  const local = useDineTuned();
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false), [note, setNote] = useState(item.note), [liked, setLiked] = useState(item.liked);
  return <article className="memory-item"><div className="memory-item-main"><span className="memory-item-date">Historical browser feedback · {new Date(item.date).toLocaleDateString()}</span><h3>{item.dish_name}</h3><p>{item.restaurant_name} · {item.liked ? 'Loved it' : 'Not for me'}</p>
    {item.note && <blockquote>“{item.note}”</blockquote>}<small>Local only · consumption not explicitly confirmed.</small>
    {!editing && !deleting && <div className="dining-record-actions"><button onClick={() => setEditing(true)}>Correct record</button><button onClick={() => setDeleting(true)}>Delete record</button></div>}
    {editing && <form className="dining-editor" onSubmit={e => { e.preventDefault(); local.correctFeedback({ ...item, note, liked }); setEditing(false); }}>
      <label>Your observations<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)}/></label>
      <label>Your experience<select value={liked ? 'yes' : 'no'} onChange={e => setLiked(e.target.value === 'yes')}><option value="yes">Loved it</option><option value="no">Not for me</option></select></label>
      <button>Save correction</button><button type="button" onClick={() => setEditing(false)}>Cancel correction</button></form>}
    {deleting && <div className="memory-confirm"><p>Delete this browser feedback?</p><button onClick={() => local.removeFeedback(item.id)}>Confirm delete</button><button onClick={() => setDeleting(false)}>Cancel deletion</button></div>}
  </div></article>;
}
export function DiningDiary() {
  const memory = useDiningMemory(), local = useDineTuned();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [filter, setFilter] = useState('all');
  const legacy = local.feedback.filter(item => !memory.data.feedback.some(row => row.value.feedback.id === item.id));
  const pending = [...memory.data.events, ...memory.data.feedback, ...memory.data.history].filter(entry => entry.status === 'pending').length;
  const positive = memory.data.feedback.filter(item => item.value.feedback.liked);
  const favorites = [...new Set([...positive.map(item => item.value.feedback.dish_name), ...legacy.filter(item => item.liked).map(item => item.dish_name)])];
  let browserCount = 0;
  try { const browser = memory.store?.browserRecords(); browserCount = (browser?.events.length || 0) + (browser?.feedback.length || 0); } catch { /* Error is reported when explicitly importing; existing data stays intact. */ }
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await action(); setMessage(memory.store?.error || 'Dining history updated. No AI learning has taken place.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'This operation could not be confirmed.'); } finally { setBusy(false); } };
  const count = memory.data.events.length + memory.data.feedback.length + legacy.length;
  return <section aria-labelledby="diary-heading">
    <div className="memory-stats"><div><span className="stat-value">{memory.data.events.filter(item => item.value.event_type === 'tasted').length}</span><span>Confirmed dishes tried</span></div>
      <div><span className="stat-value">{memory.data.feedback.length + legacy.length}</span><span>Ratings & feedback</span></div><div><span className="stat-value">{favorites.length}</span><span>Dishes you loved</span></div></div>
    <div className="section-label-row"><div><h2 id="diary-heading">Your dining diary.</h2><p>Interest, ordering, trying, and enjoyment each tell a different story.</p></div></div>
    <div className="dining-toolbar">
      <label>Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All dining records</option>{Object.entries(eventLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}<option value="ratings">Ratings & feedback</option><option value="favorites">Dishes you loved</option></select></label>
      {memory.connected && <button disabled={busy} onClick={() => run(() => memory.store!.refresh())}>Refresh dining history</button>}
      {pending > 0 && memory.connected && <button disabled={busy} onClick={() => run(() => memory.store!.sync())}>Retry pending cloud saves</button>}
    </div>
    {(memory.error || message) && <p className="dining-notice" role="alert">{message || memory.error}</p>}
    {memory.connected && (legacy.length > 0 || browserCount > 0) && <details className="dining-import"><summary>Bring existing browser memories into this account</summary><p>This is an explicit copy. Old feedback keeps its original context and does not imply the dish was eaten.</p>
      {browserCount > 0 && <button disabled={busy} onClick={() => run(() => memory.store!.importBrowserRecords())}>Copy browser dining records</button>}
      {legacy.length > 0 && <button disabled={busy} onClick={() => run(() => memory.store!.importLegacy(legacy))}>Copy historical browser feedback</button>}</details>}
    {!count ? <div className="memory-empty"><div className="empty-icon"><Icon name="heart" size={35}/></div><h3>Every favorite starts with a first bite.</h3><p>Save a dish, confirm an order, or record a meal experience from your Personalized Picks.</p><ButtonLink href="/discover">Find your next dish <Icon name="arrow" size={17}/></ButtonLink></div>
      : <div className="memories-list">{memory.data.events.filter(entry => filter === 'all' || filter === entry.value.event_type).map(entry => <DiaryRecord key={entry.value.id + ('revision' in entry.value ? entry.value.revision : '')} entry={entry} kind="events"/>)}
        {memory.data.feedback.filter(entry => ['all','ratings'].includes(filter) || filter === 'favorites' && entry.value.feedback.liked).map(entry => <DiaryRecord key={entry.value.id + ('revision' in entry.value ? entry.value.revision : '')} entry={entry} kind="feedback"/>)}
        {legacy.filter(item => ['all','ratings'].includes(filter) || filter === 'favorites' && item.liked).map(item => <LegacyRecord key={item.id} item={item}/>)}</div>}
  </section>;
}
