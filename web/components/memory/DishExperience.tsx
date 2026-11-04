'use client';
import { useEffect, useRef, useState } from 'react';
import type { DiningEventWrite, DishFeedbackWrite, Recommendation, RecommendationSession } from '../../lib/contracts';
import { actionRecords, eventLabels, feedbackTags, memoryId } from '../../lib/memory/journal';
import { useDiningMemory } from './DiningMemoryProvider';
import { useDineTuned } from '../AppProvider';
import { Icon } from '../UI';

export function DishExperience({ recommendation: rec, session }: { recommendation: Recommendation; session: RecommendationSession }) {
  const memory = useDiningMemory(), local = useDineTuned();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [note, setNote] = useState(''), [rating, setRating] = useState<number | null>(null);
  const [tried, setTried] = useState(false), [tags, setTags] = useState<DishFeedbackWrite['tags']>([]);
  const lock = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const feedbackId = session.id + '-' + rec.dish.id;
  const saved = local.feedback.some(item => item.id === feedbackId) || memory.data.feedback.some(item => item.value.feedback.id === feedbackId);
  const history = memory.data.history.find(item => item.value.session_id === session.id);
  const recorded = memory.data.events.filter(item => item.value.recommendation_id === history?.value.id && item.value.dish_id === rec.dish.id);
  async function record(kind: DiningEventWrite['event_type'], liked?: boolean) {
    const store = memory.store;
    if (!store || lock.current || (liked !== undefined && !tried && !recorded.some(item => item.value.event_type === 'tasted'))) return;
    lock.current = true; setBusy(true); setMessage('Saving your dining note…');
    try {
      const { history, event } = await actionRecords(store.owner, session, rec, kind);
      const feedback: DishFeedbackWrite | undefined = liked === undefined ? undefined : {
        id: await memoryId(`${store.owner}:${feedbackId}:rating`), event_id: event.id, rating, tags,
        feedback: { id: feedbackId, restaurant_id: session.restaurant.id, restaurant_name: session.restaurant.name,
          dish_id: rec.dish.id, dish_name: rec.dish.name, menu_version: session.menu_version, liked, note, date: new Date().toISOString() },
      };
      try { await store.record(history, event, feedback); }
      finally {
        // Keep the existing local feedback path, including visible pending cloud writes.
        if (feedback && store.data.feedback.some(item => item.value.id === feedback.id)) local.addFeedback(feedback.feedback);
      }
      if (active.current) setMessage(store.repository ? 'Saved to your private dining history.' : 'Saved in this browser only. Cloud storage is not connected.');
    } catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : 'This save could not be confirmed.'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <div className="dish-experience">
    <div className="dining-actions" aria-label={`Dining actions for ${rec.dish.name}`}>
      {(['saved','selected','ordered','tasted'] as const).map(kind => {
        const done = recorded.some(item => item.value.event_type === kind);
        const labels = { saved: 'Save dish', selected: 'Select dish', ordered: 'I ordered this', tasted: 'I tried this' };
        return <button key={kind} type="button" disabled={busy || !memory.store || done} aria-pressed={done} onClick={() => record(kind)}>
          {done && <Icon name="check" size={13}/>} {done ? eventLabels[kind] : labels[kind]}</button>;
      })}
    </div>
    <p className="dining-caption">Saving or selecting expresses interest. Ordering and trying are separate confirmations.</p>
    {message && <p className="dining-save-message" role="status">{message}</p>}
    <details className="feedback-sheet"><summary><Icon name="heart" size={16}/>{saved ? 'Experience saved' : 'Tried this? Tell us how it went'}<Icon name="plus" size={15}/></summary>
      {saved ? <p className="success-note">Your rating is recorded in Memory, where you can review its save status, correct it, or delete it. No model learning has taken place.</p> : <div>
        <label className="dining-confirm-tried"><input type="checkbox" checked={tried || recorded.some(item => item.value.event_type === 'tasted')}
          onChange={event => setTried(event.target.checked)} disabled={recorded.some(item => item.value.event_type === 'tasted')}/> I confirm I tried this dish</label>
        <label htmlFor={'rating-' + rec.dish.id}>Your rating <span>(optional)</span></label>
        <select id={'rating-' + rec.dish.id} value={rating ?? ''} onChange={event => setRating(event.target.value ? Number(event.target.value) : null)}>
          <option value="">No star rating</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} / 5</option>)}
        </select>
        <label htmlFor={'feedback-'+rec.dish.id}>What stood out? <span>(optional)</span></label>
        <textarea id={'feedback-'+rec.dish.id} value={note} maxLength={1000} rows={3} placeholder="The heat, the texture, that first bite…" onChange={event => setNote(event.target.value)}/>
        <div className="dining-tags" aria-label="Taste observations">{Object.entries(feedbackTags).map(([key, label]) => {
          const tag = key as DishFeedbackWrite['tags'][number];
          return <button key={key} aria-pressed={tags.includes(tag)} onClick={() => setTags(previous => previous.includes(tag) ? previous.filter(item => item !== tag) : [...previous, tag])}>{label}</button>;
        })}</div>
        <div className="feedback-actions"><button disabled={busy || !memory.store || (!tried && !recorded.some(item => item.value.event_type === 'tasted'))} onClick={() => record('tasted', true)}><Icon name="heart" size={15}/> Loved it</button>
          <button disabled={busy || !memory.store || (!tried && !recorded.some(item => item.value.event_type === 'tasted'))} onClick={() => record('tasted', false)}>Not for me</button></div>
      </div>}
    </details>
  </div>;
}
