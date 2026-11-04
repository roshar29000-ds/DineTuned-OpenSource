'use client';
import { useEffect, useId, useState } from 'react';
import type { AllergyProfile, DietaryRestriction, DiningConstraints } from '../../lib/contracts';
import { allergens, diets, hasAllergies, money } from '../../lib/preferences';
import { Icon } from '../UI';
import { useDineTuned } from '../AppProvider';

export function ProteinPreference() {
  const id = useId();
  const { recommendationOptions, setRecommendationOptions } = useDineTuned();
  return <div className="context-controls protein-preference"><label htmlFor={id}>Protein preference for this meal</label>
    <select id={id} value={recommendationOptions.protein_preference} onChange={event => setRecommendationOptions({ ...recommendationOptions, protein_preference: event.target.value as typeof recommendationOptions.protein_preference })}>
      <option value="any">Open to any protein</option><option value="plant_forward">Plant-forward</option><option value="chicken">Chicken</option><option value="beef">Beef</option><option value="pork">Pork</option><option value="seafood">Seafood</option>
    </select><p className="control-hint">A temporary preference for Picks. Dietary restrictions and allergies always take priority.</p></div>;
}

export function BudgetControl({ value, onChange, sliderStepMinor = 1, softTarget = false }: { value: number; onChange: (cents: number) => void; sliderStepMinor?: 1 | 100; softTarget?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(String(value / 100));
  useEffect(() => { setDraft(String(value / 100)); }, [value]);
  const amount = Number(draft);
  // Exact typed/saved limits remain untouched. Only a slider gesture chooses a whole dollar.
  const sliderValue = Math.floor(value / sliderStepMinor) * sliderStepMinor;
  const sliderMax = Math.max(6000, Math.ceil(value / sliderStepMinor) * sliderStepMinor);
  const invalid = draft.trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > 1000 || Math.abs(amount * 100 - Math.round(amount * 100)) > .000001;
  return <div className="budget-control">
    <div className="control-heading"><label htmlFor={id}>Budget per dish</label><span>USD</span></div>
    <div className="budget-value"><span aria-hidden="true">$</span>
      <input id={id} type="number" min="0" max="1000" step=".01" inputMode="decimal" value={draft}
        aria-invalid={invalid} aria-describedby={id+'-hint'} onChange={event => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() && Number.isFinite(next) && next >= 0 && next <= 1000
            && Math.abs(next * 100 - Math.round(next * 100)) < .000001) onChange(Math.round(next * 100));
        }} onBlur={() => { if (invalid) setDraft(String(value / 100)); }} />
      <span className="budget-max">{softTarget ? 'target' : 'maximum'}</span></div>
    <input type="range" aria-label="Budget per dish slider" aria-describedby={id+'-hint'} aria-valuetext={money(sliderValue) + (sliderValue !== value ? ` on the slider; exact limit ${money(value)} entered above` : ' per dish')}
      min="0" max={sliderMax} step={sliderStepMinor} value={sliderValue} onChange={event => onChange(Number(event.target.value))}
      style={{ '--range-progress': `${sliderValue / sliderMax * 100}%` } as React.CSSProperties} />
    <div className="budget-range"><span>$0</span><span>{money(sliderMax)}</span></div>
    <p className="control-hint" id={id+'-hint'}>{invalid ? 'Enter $0–$1,000, with up to two decimal places. Your last valid budget is still applied.'
      : sliderStepMinor === 100 ? `Slide in $1 steps, or enter an exact ${softTarget ? 'target' : 'limit'} above. Before tax and tip.` : 'Menu price per dish, before tax and tip.'}</p>
  </div>;
}

export function DietaryControls({ value, onChange, realMenu = false }: { value: DietaryRestriction[]; onChange: (value: DietaryRestriction[]) => void; realMenu?: boolean }) {
  return <fieldset className="preference-fieldset"><legend>Dietary restrictions</legend><p className="control-hint">Choose all that apply. Picks must satisfy every selection.</p>
    <div className="checkbox-chips">{diets.map(diet => <label className={value.includes(diet.value) ? 'selected' : ''} key={diet.value}>
      <input type="checkbox" checked={value.includes(diet.value)} onChange={event => onChange(event.target.checked ? [...value, diet.value] : value.filter(item => item !== diet.value))}/>
      <span>{diet.label}</span>{value.includes(diet.value) && <Icon name="check" size={13}/>}
    </label>)}</div><p className="control-hint">{realMenu
      ? 'Unknown ingredients can exclude a dish from real-menu Picks. Add allergies separately below; confirm all requirements with staff.'
      : 'These rules exclude dishes from Picks. Add allergies separately below.'}</p>
  </fieldset>;
}

export function AllergyControls({ value, onChange, extracted = false }: { value: AllergyProfile; onChange: (value: AllergyProfile) => void; extracted?: boolean }) {
  const id = useId();
  return <details className="allergy-panel" open={hasAllergies(value) || undefined}>
    <summary><Icon name="shield" size={18}/><span>Food allergies</span><span className="allergy-count">{value.allergens.length + (value.other.trim() ? 1 : 0) || 'Add'}</span></summary>
    <div className="allergy-panel-body"><p>Separate from preferences. Missing ingredient or cross-contact information will exclude a dish from your picks.</p>
      <fieldset className="preference-fieldset"><legend className="sr-only">Allergens to avoid</legend>
        <div className="checkbox-chips">{allergens.map(allergen => <label className={value.allergens.includes(allergen.value) ? 'selected' : ''} key={allergen.value}>
          <input type="checkbox" checked={value.allergens.includes(allergen.value)} onChange={event => onChange({ ...value, allergens: event.target.checked
            ? [...value.allergens, allergen.value] : value.allergens.filter(item => item !== allergen.value) })}/><span>{allergen.label}</span>
        </label>)}</div>
      </fieldset>
      <label className="small-label" htmlFor={id}>Another allergy or ingredient concern</label>
      <input id={id} className="text-input" value={value.other} maxLength={200} placeholder="e.g. kiwi" onChange={event => onChange({ ...value, other: event.target.value })}/>
      <p className="allergy-caution"><Icon name="info" size={15}/><span>{extracted ? 'Extracted menu text' : 'Sample menus'} {extracted ? 'does' : 'do'} not establish allergy safety. Confirm ingredients and preparation directly with the restaurant.</span></p>
    </div>
  </details>;
}

export function ContextControls({ value, onChange }: { value: DiningConstraints; onChange: (value: DiningConstraints) => void }) {
  const id = useId();
  return <fieldset className="preference-fieldset context-controls"><legend>What sounds good today?</legend>
    <label htmlFor={id+'mood'}>In the mood for</label>
    <select id={id+'mood'} value={value.mood} onChange={event => onChange({ ...value, mood: event.target.value as DiningConstraints['mood'] })}>
      <option value="open">Open to anything</option><option value="cozy">Rich & comforting</option><option value="fresh">Light & fresh</option><option value="bold">Bold flavors</option>
    </select>
    <label htmlFor={id+'appetite'}>My appetite</label>
    <select id={id+'appetite'} value={value.appetite} onChange={event => onChange({ ...value, appetite: event.target.value as DiningConstraints['appetite'] })}>
      <option value="any">A little of anything</option><option value="light">Something small</option><option value="hearty">A hearty dish</option>
    </select><p className="control-hint">These guide your picks. They never override your restrictions.</p>
  </fieldset>;
}

export function MenuFilters({ value, onChange, onHardChange }: {
  value: DiningConstraints; onChange: (value: DiningConstraints) => void; onHardChange: (value: DiningConstraints) => void;
}) {
  return <div className="menu-filters-content">
    <div className="filter-intro"><span className="section-kicker">A LITTLE MORE YOU</span><h2>Set your <em>table.</em></h2><p>For this meal, just as you like it.</p></div>
    <BudgetControl value={value.max_price_minor} sliderStepMinor={100} onChange={max_price_minor => onHardChange({ ...value, max_price_minor })}/>
    <DietaryControls value={value.dietary_restrictions} onChange={dietary_restrictions => onHardChange({ ...value, dietary_restrictions })}/>
    <AllergyControls value={value.allergies} onChange={allergies => onHardChange({ ...value, allergies })}/>
    <ContextControls value={value} onChange={onChange}/>
    <ProteinPreference/>
    <p className="filter-footnote"><Icon name="info" size={15}/> Matching uses curated demo information. Nothing here certifies allergen safety.</p>
  </div>;
}
