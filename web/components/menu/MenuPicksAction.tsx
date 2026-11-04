'use client';
import { useId } from 'react';
import { money } from '../../lib/preferences';
import { Icon } from '../UI';

export type PicksAvailability = { loading: boolean; unavailable: boolean; eligibleCount: number | null; candidateCount: number | null; budget: number };
export function MenuPicksAction({ state, onChoose, secondary = false }: {
  state: PicksAvailability; onChoose: () => void; secondary?: boolean;
}) {
  const id = useId();
  const disabled = state.loading || state.unavailable || state.candidateCount === null || state.candidateCount === 0;
  const label = state.loading ? 'Checking your preferences…' : state.unavailable ? 'Picks temporarily unavailable'
    : state.candidateCount === 0 ? 'No matching picks yet' : 'Find My Personal Picks';
  return <div className="menu-picks-action">
    <button type="button" className={`button ${secondary ? 'button-outline' : 'button-primary'} menu-picks-button`}
      onClick={onChoose} disabled={disabled} aria-describedby={id}>
      {!disabled && <Icon name="spark" size={17}/>}<span>{label}</span><Icon name="arrow" size={17}/>
    </button>
    <p id={id} className="menu-picks-context">{state.loading ? 'Updating with your latest preferences' : state.unavailable ? 'Retry the preference check to continue'
      : state.candidateCount === 0 ? 'Review your preferences · safeguards unchanged'
        : state.eligibleCount === 0 ? 'Above-budget alternatives may qualify'
        : state.eligibleCount === null ? 'Waiting for the preference check'
          : `${state.eligibleCount} eligible ${state.eligibleCount === 1 ? 'dish' : 'dishes'} · up to 3 taste-qualified picks`}
      <span>{money(state.budget)} target for Picks · alternatives labeled</span></p>
  </div>;
}
