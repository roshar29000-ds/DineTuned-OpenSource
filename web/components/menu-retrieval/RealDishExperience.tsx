'use client';
import { useRef, useState, type ReactNode } from 'react';
import type { DiningEventWrite, DishFeedbackWrite, RealPersonalizedPick, RealPicksResult } from '../../lib/contracts';
import { eventLabels, feedbackTags, memoryId } from '../../lib/memory/journal';
import { realActionRecords } from '../../lib/real-picks-memory';
import { useDiningMemory } from '../memory/DiningMemoryProvider';

/** Same journal and cloud status as demo dish actions; real source IDs are preserved. */
export function RealDishExperience({ result, pick, restaurantName, details }: { result: RealPicksResult;
  pick: RealPersonalizedPick; restaurantName: string; details: ReactNode }) {
  const memory = useDiningMemory();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [tried, setTried] = useState(false), [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState(''), [tags, setTags] = useState<DishFeedbackWrite['tags']>([]);
  const [expanded, setExpanded] = useState(false);
  const lock = useRef(false);
  const history = memory.data.history.find(row => row.value.session_id === result.request_id);
  const recorded = memory.data.events.filter(row => row.value.recommendation_id === history?.value.id && row.value.dish_id === pick.dish.id);
  const feedbackId = `real-${result.request_id}-${pick.dish.id}`;
  const rated = memory.data.feedback.some(row => row.value.feedback.id === feedbackId);
  async function record(kind: DiningEventWrite['event_type'], liked?: boolean) {
    const store = memory.store;
    if (!store || lock.current || liked !== undefined && !tried && !recorded.some(row => row.value.event_type === 'tasted')) return;
    lock.current = true; setBusy(true); setMessage('Saving your dining note…');
    try {
      const { history, event } = await realActionRecords(store.owner, result, restaurantName, pick, kind);
      const feedback: DishFeedbackWrite | undefined = liked === undefined ? undefined : {
        id: await memoryId(`${store.owner}:${feedbackId}:rating`), event_id: event.id, rating, tags,
        feedback: { id: feedbackId, restaurant_id: result.restaurant_id, restaurant_name: restaurantName,
          dish_id: pick.dish.id, dish_name: pick.dish.name, menu_version: result.menu_version,
          liked, note, date: new Date().toISOString() },
      };
      await store.record(history, event, feedback);
      setMessage(store.repository ? 'Saved to your private dining history.' : 'Saved in this browser only. Cloud storage is not connected.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This save could not be confirmed.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const action = (kind: DiningEventWrite['event_type']) => {
        const done = recorded.some(row => row.value.event_type === kind);
        const labels = { saved: 'Save dish', selected: 'Select dish', ordered: 'I ordered this', tasted: 'I tried this' };
        return <button key={kind} type="button" disabled={busy || !memory.store || done} aria-pressed={done}
          className={kind === 'selected' ? 'real-pick-choose' : undefined}
          aria-label={labels[kind]} onClick={() => void record(kind)}>{done ? eventLabels[kind] : kind === 'selected' ? 'Choose dish' : labels[kind]}</button>;
  };
  return <div className="real-dish-experience">
    <div className="dining-actions dining-actions-primary" aria-label={`Choose or save ${pick.dish.name}`}>{action('selected')}{action('saved')}</div>
    {message && <p role="status" className="real-dish-feedback-status">{message}</p>}
    <button type="button" className="real-pick-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Less about this pick' : 'More about this pick'} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    {expanded && <div className="real-pick-expanded">{details}
    <div className="dining-actions dining-actions-secondary" aria-label={`Dining actions for ${pick.dish.name}`}>{action('ordered')}{action('tasted')}</div>
    <small>Saving or selecting records interest. Only “I tried this” confirms consumption.</small>
    <details className="real-dish-rating"><summary>{rated ? 'Experience recorded' : 'Rate this dish after trying it'}</summary>
      {rated ? <p>Review or correct your rating in Memory. New recommendations can use your updated report.</p> : <div>
        <label><input type="checkbox" checked={tried || recorded.some(row => row.value.event_type === 'tasted')}
          disabled={recorded.some(row => row.value.event_type === 'tasted')}
          onChange={event => setTried(event.target.checked)}/> I confirm I tried this dish</label>
        <label>Rating (optional) <select value={rating ?? ''} onChange={event => setRating(event.target.value ? Number(event.target.value) : null)}>
          <option value="">No star rating</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label>What stood out? <textarea value={note} maxLength={1000} rows={2} onChange={event => setNote(event.target.value)}/></label>
        <div className="dining-tags" aria-label="Taste observations">{Object.entries(feedbackTags).map(([key, label]) => {
          const tag = key as DishFeedbackWrite['tags'][number];
          return <button key={key} type="button" aria-pressed={tags.includes(tag)} onClick={() => setTags(previous => previous.includes(tag)
            ? previous.filter(item => item !== tag) : [...previous, tag])}>{label}</button>;
        })}</div>
        <div className="feedback-actions"><button type="button" disabled={busy || !memory.store || !tried && !recorded.some(row => row.value.event_type === 'tasted')}
          onClick={() => void record('tasted', true)}>Loved it</button>
          <button type="button" disabled={busy || !memory.store || !tried && !recorded.some(row => row.value.event_type === 'tasted')}
            onClick={() => void record('tasted', false)}>Not for me</button></div>
      </div>}
    </details></div>}
  </div>;
}
