'use client';
import { useId } from 'react';
import type { RecommendationSession, RefinementRequest } from '../../lib/contracts';
import { emptyRefinements, hasRefinements, refinementChoices, toggleRefinement, tryAnother } from '../../lib/refinements';
import { Icon } from '../UI';

export function MakeItMoreMe({ value, session, loading, tuning, error, onChange }: {
  value: RefinementRequest; session: RecommendationSession | null; loading: boolean; tuning: boolean; error: boolean;
  onChange: (value: RefinementRequest) => void;
}) {
  const id = useId();
  const result = session?.refinement_result;
  const alternative = session && !loading ? tryAnother(value, session) : null;
  return <section className="make-it-more-me" aria-labelledby={id}>
    <header className="mm-heading"><div><span className="mm-eyebrow">THE FINISHING TOUCH · DEMO</span><h2 id={id}>Make It <em>More Me</em></h2>
      <p>A little less of this. A little more of you.</p></div><span className="mm-session"><Icon name="clock" size={15}/> Just for this meal</span></header>
    <div className="mm-choices" role="group" aria-label="Temporary dish refinements">{refinementChoices.map(choice => {
      const selected = value.preferences.includes(choice.id);
      return <button key={choice.id} type="button" aria-pressed={selected} aria-label={choice.label}
        onClick={() => onChange(toggleRefinement(value, choice.id))}>
        <Icon name={choice.icon} size={20}/><span><strong>{choice.label}</strong><small>{choice.hint}</small></span>
        <span className="mm-choice-mark" aria-hidden="true"><Icon name={selected ? 'check' : 'plus'} size={14}/></span>
      </button>;
    })}</div>
    <p className="mm-hint">Combine preferences, or tap a selected one to remove it. Your saved Taste DNA stays unchanged.</p>
    {!!value.avoid_dish_ids.length && <div className="mm-set-aside"><span>{value.avoid_dish_ids.length} earlier {value.avoid_dish_ids.length === 1 ? 'pick' : 'picks'} set aside</span>
      <button type="button" onClick={() => onChange({ ...value, avoid_dish_ids: [] })}>Bring back earlier picks <Icon name="close" size={14}/></button></div>}
    <div className="mm-actions"><div><button type="button" className="mm-another" disabled={!alternative} aria-describedby={`${id}-another`}
      onClick={() => { if (alternative) onChange(alternative); }}><Icon name="compass" size={17}/> Try another dish <Icon name="arrow" size={16}/></button>
      <p id={`${id}-another`}>Set these picks aside and look for other strong matches.</p></div>
      <button type="button" className="mm-reset" disabled={!hasRefinements(value)} onClick={() => onChange(emptyRefinements())}><Icon name="reset" size={16}/> Reset refinements</button></div>
    <div className="mm-response" role="status" aria-live="polite" aria-atomic="true" data-refinement-status={loading ? 'loading' : error ? 'error' : result?.status ?? 'inactive'}>
      {loading ? <p><Icon name="adjust" size={16}/><span>{tuning ? 'Tuning Your Table' : 'Preparing your selection'}<small>Comparing this demo menu with your preferences. No live AI is running.</small></span></p>
        : <p><Icon name={error ? 'info' : 'spark'} size={16}/><span>{error ? 'We couldn’t refresh this selection. Try again below, or adjust your refinements.' : result?.message || 'Your taste, your call. Choose a temporary direction above.'}</span></p>}
    </div>
    {!!result?.limitations.length && <details className="mm-limits"><summary>What these preferences can tell us <Icon name="plus" size={15}/></summary>
      <ul>{result.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>}
  </section>;
}
