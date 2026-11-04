'use client';
import { useState, type ReactNode } from 'react';

export type PreviewExperienceState = { events: string[]; rating: string; note: string };
/** Isolated editorial demo state: never reads identity, Supabase, or browser storage. */
export function PreviewDishExperience({ dishName, details, value, onChange }: { dishName: string; details: ReactNode;
  value?: PreviewExperienceState; onChange?: (value: PreviewExperienceState) => void }) {
  const [local, setLocal] = useState<PreviewExperienceState>({ events: [], rating: '', note: '' });
  const state = value || local;
  const { events, rating, note } = state;
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const update = (next: PreviewExperienceState) => { if (onChange) onChange(next); else setLocal(next); };
  function record(kind: string) {
    update({ ...state, events: events.includes(kind) ? events : [...events, kind] });
    setMessage(`${kind} in this offline preview only. Your real dining history was not changed.`);
  }
  return <div className="real-dish-experience preview-dish-experience">
    <div className="dining-actions dining-actions-primary" aria-label={`Preview dining actions for ${dishName}`}>
      {(['Select dish', 'Save dish'] as const).map(label => <button key={label} type="button"
        className={label === 'Select dish' ? 'real-pick-choose' : undefined} aria-label={label}
        aria-pressed={events.includes(label)} onClick={() => record(label)}>{events.includes(label) ? `${label} ✓` : label === 'Select dish' ? 'Choose dish' : 'Save'}</button>)}
    </div>
    <button type="button" className="real-pick-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Less about this pick' : 'More about this pick'} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
    {expanded && <div className="real-pick-expanded">{details}
    <div className="dining-actions dining-actions-secondary" aria-label={`Preview dining milestones for ${dishName}`}>
      {(['I ordered this', 'I tried this'] as const).map(label => <button key={label} type="button"
        aria-pressed={events.includes(label)} onClick={() => record(label)}>{events.includes(label) ? `${label} ✓` : label}</button>)}
    </div>
    <small>Offline demonstration. Saving here never touches your guest account.</small>
    <details className="real-dish-rating"><summary>Rate this dish · preview</summary>
      <label>Rating <select value={rating} onChange={event => update({ ...state, rating: event.target.value })}><option value="">Choose a rating</option>
        {[1,2,3,4,5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>
      <label>What stood out? <textarea rows={2} value={note} onChange={event => update({ ...state, note: event.target.value })} maxLength={300}/></label>
      <button type="button" disabled={!rating || !events.includes('I tried this')} onClick={() => {
        update({ ...state, events: [...new Set([...events, 'Rated dish'])] });
        setMessage(`Your ${rating}/5 rating for ${dishName} stays in this offline preview only.`);
      }}>Record preview rating</button>
    </details></div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
