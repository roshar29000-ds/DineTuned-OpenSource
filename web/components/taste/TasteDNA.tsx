'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useDineTuned } from '../AppProvider';
import { ButtonLink, Eyebrow, Icon } from '../UI';
import { AllergyControls, DietaryControls } from '../menu/PreferenceControls';
import { axisLabels, axisNames, type Axis } from '../../lib/preferences';
import { demoDetective } from '../../lib/detective/engine';
import { labelFor, type ChoiceKey } from '../../lib/detective/model';
import { SensoryMap } from './SensoryMap';

const endpoints: Record<Axis, [string, string]> = {
  spice: ['Mellow', 'Fiery'], richness: ['Light', 'Indulgent'], freshness: ['Rounded', 'Bright'],
  crunch: ['Soft', 'Crisp'], aromatic: ['Subtle', 'Fragrant'], sweetness: ['Less sweet', 'Sweet accents'], umami: ['Delicate', 'Deeply savory'],
};

export function TasteDNA({ demoNavigation }: { demoNavigation?: { revisit: () => void; explore: () => void } } = {}) {
  const { taste, detective, tasteEdits, constraints, updateAxis, setExploration, setConstraints } = useDineTuned();
  const [selected, setSelected] = useState<Axis>('spice');
  const reading = detective ? demoDetective.analyze(detective.answers) : null;
  const known = axisNames.filter(axis => taste.axes[axis] !== null).length;
  const direct = axisNames.filter(axis => taste.axes[axis] !== null && (tasteEdits.axes.includes(axis) || reading?.axes[axis].basis === 'stated' || (reading && taste.axes[axis] !== reading.axes[axis].value))).length;
  function evidenceFor(axis: Axis) {
    if (taste.axes[axis] === null) return { status: 'Open', explanation: 'No preference recorded. Unknown is not a neutral score.', evidence: ['You can leave this open, adjust it below, or revisit the conversation.'] };
    if (tasteEdits.axes.includes(axis) || (reading && taste.axes[axis] !== reading.axes[axis].value)) return { status: 'Edited by you', explanation: 'Your manual adjustment takes precedence over the demo clues.', evidence: ['You set this dimension directly on your Taste DNA.'] };
    if (!reading) return { status: 'Saved', explanation: 'A preference carried forward from your existing profile.', evidence: ['Detailed question evidence was not recorded in this earlier profile.'] };
    const signal = reading.axes[axis];
    return { status: signal.confidence, explanation: signal.basis === 'stated' ? 'A direct response, translated to an illustrative scale.' : 'A tentative inference from your selections. Confirm or adjust it.', evidence: signal.evidence };
  }
  const selectedEvidence = evidenceFor(selected);
  const lead = taste.axes.crunch !== null && taste.axes.crunch > .65 && taste.axes.freshness !== null && taste.axes.freshness > .65
    ? 'Crisp edges. Bright finishes.' : taste.axes.richness !== null && taste.axes.richness > .7
      ? 'A soft spot for comfort.' : known > 0 ? 'A taste that’s all your own.' : 'A little room for discovery.';
  const tags = (key: ChoiceKey) => detective?.answers.choices[key].map(id => labelFor(key, id)) || [];
  const curiosityUnknown = !!reading && reading.exploration === null && !tasteEdits.exploration;
  return <main className="v3-taste v3-dna content-width page-padding">
    <header className="v3-page-heading"><div><Eyebrow>YOUR PERSONAL TASTE ATLAS</Eyebrow><h1>Your Taste <em>DNA.</em></h1><p>More than favorites. The details that make a dish feel like you.</p></div>
      {demoNavigation ? <button type="button" className="button button-outline" onClick={demoNavigation.revisit}><Icon name="adjust" size={16}/> Revisit my answers</button>
        : <Link href="/onboarding" className="button button-outline"><Icon name="adjust" size={16}/> Revisit my answers</Link>}</header>
    <section className="v3-dna-intro"><div><span className="v3-overline">A PORTRAIT, ALWAYS IN PROGRESS</span><h2>{lead}</h2><p>{detective ? 'Built from your tasting notes. Refine it whenever your tastes change.' : 'Your existing preferences are preserved. Revisit Taste Detective to add richer evidence.'}</p><p className="taste-muse-note">Your choices shape this profile. For approved real-menu Picks, Meta Muse Spark uses it to consider dishes that may suit you.</p></div>
      <div className="v3-coverage"><strong>{known}<small>/7</small></strong><span>dimensions explored</span><div aria-hidden="true">{axisNames.map(axis => <i key={axis} className={taste.axes[axis] === null ? '' : 'filled'}/>)}</div></div></section>
    <div className="v3-dna-grid">
      <section className="v3-map-panel"><div className="v3-panel-heading"><span className="v3-overline">01 / SENSORY SIGNATURE</span><span className="v3-live-dot">Demo interpretation</span></div>
        <SensoryMap axes={taste.axes} selected={selected} onSelect={setSelected}/>
        <div className="v3-map-legend"><span><i/> Recorded preference</span><span><i className="open"/> Still unknown</span></div>
        <p>Tap a dimension to inspect its evidence. Values describe preference intensity, not the probability you’ll enjoy a dish.</p>
      </section>
      <section className="v3-evidence-panel" aria-label="Sensory evidence"><span className="v3-overline">02 / BEHIND THE SIGNATURE</span>
        <div className="v3-evidence-title"><h2>{axisLabels[selected]}</h2><span className={'v3-confidence ' + (selectedEvidence.status === 'Tentative' ? 'tentative' : '')}>{selectedEvidence.status}</span></div>
        <div className="v3-evidence-value"><strong>{taste.axes[selected] === null ? '—' : Math.round(taste.axes[selected]! * 100)}</strong><span>{taste.axes[selected] === null ? 'An open dimension' : '/ 100 · preference intensity'}</span></div>
        <p>{selectedEvidence.explanation}</p>
        <div className="v3-evidence-lines">{selectedEvidence.evidence.map(item => <div key={item}><Icon name="message" size={16}/><p>{item}</p></div>)}</div>
        <div className="v3-evidence-selectors" aria-label="Inspect a sensory dimension">{axisNames.map(axis => <button key={axis} aria-pressed={axis === selected} onClick={() => setSelected(axis)}>{axisLabels[axis]}</button>)}</div>
        <p className="v3-small-note">Evidence confidence: Direct = you said it. Tentative = a rule-based clue. Open = unknown. These labels are not validated prediction confidence.</p>
      </section>
    </div>
    <section className="v3-dimensions"><div className="v3-section-heading"><div><span className="v3-overline">FINE-TUNE THE DETAILS</span><h2>The full flavor spectrum.</h2></div><span>Preference intensity · 0–100</span></div>
      <div className="v3-dimension-grid">{axisNames.map(axis => {
        const evidence = evidenceFor(axis), value = taste.axes[axis];
        return <details className="v3-dimension" key={axis}>
          <summary><span><strong>{axisLabels[axis]}</strong><small>{evidence.status}</small></span><b>{value === null ? 'Open' : Math.round(value * 100)}</b><Icon name="plus" size={16}/></summary>
          <div className="v3-dimension-track" aria-hidden="true"><span style={{ width: value === null ? '0%' : value * 100 + '%' }}/></div>
          <div className="v3-dimension-edit"><label htmlFor={'axis-'+axis}>{axisLabels[axis]}</label><input id={'axis-'+axis} type="range" min="0" max="100" value={Math.round((value ?? .5) * 100)}
            aria-valuetext={value === null ? 'Unknown; move to set a preference' : Math.round(value * 100) + ' out of 100'} onChange={event => updateAxis(axis, Number(event.target.value) / 100)}/>
            <div className="v3-scale-labels"><span>{endpoints[axis][0]}</span><span>{endpoints[axis][1]}</span></div>
            <p>{evidence.explanation}</p>{value !== null && <button className="text-button" onClick={() => updateAxis(axis, null)}>Leave {axisLabels[axis].toLowerCase()} unknown</button>}
          </div>
        </details>;
      })}</div>
      <p className="v3-small-note">Numeric mappings are illustrative demo values. Current menus may lack some attributes; those dimensions cannot contribute to matching until menu evidence exists.</p>
    </section>
    <div className="v3-notes-grid">
      <section className="v3-notebook"><span className="v3-overline">03 / YOUR TASTING NOTES</span><h2>The details worth remembering.</h2>
        {detective ? <><div className="v3-note-group"><h3>Your familiar favorites</h3><div className="v3-note-tags">{tags('anchors').length ? tags('anchors').map(tag => <span key={tag}>{tag}</span>) : <p>Still discovering. No favorites assumed.</p>}</div></div>
          {(['texture', 'ingredients', 'avoids', 'cooking'] as ChoiceKey[]).map(key => <div className="v3-note-group" key={key}><h3>{{ texture: 'Textures you enjoy', ingredients: 'Usually a yes', avoids: 'Prefer less of', cooking: 'From the kitchen' }[key as 'texture' | 'ingredients' | 'avoids' | 'cooking']}</h3>
            <div className={'v3-note-tags' + (key === 'avoids' ? ' muted' : '')}>{tags(key).length ? tags(key).map(tag => <span key={tag}>{tag}</span>) : <p>No preference recorded.</p>}</div></div>)}</>
          : <p className="v3-legacy-story">{taste.favorites || 'Your original profile has no food story.'}</p>}
        <div className="v3-notes-caution"><Icon name="info" size={17}/><p>Saved dish, ingredient, texture and cooking notes guide demo Picks. Mentioned dislikes exclude a primary pick; missing ingredients do not prove absence. Dietary and allergy safeguards remain separate.</p></div>
      </section>
      <div className="v3-notes-side"><section className="v3-discovery-card"><span className="v3-overline">04 / CULINARY CURIOSITY</span><Icon name="compass" size={31}/>
        <h2>{curiosityUnknown ? 'Still an open invitation.' : taste.exploration > .7 ? 'A seat at a new table.' : taste.exploration < .3 ? 'The pleasure of the familiar.' : 'Familiar, with a little surprise.'}</h2>
        <label htmlFor="exploration">Appetite for discovery <b>{curiosityUnknown ? 'Not answered' : Math.round(taste.exploration * 100) + '/100'}</b></label>
        <input id="exploration" type="range" min="0" max="100" value={Math.round(taste.exploration * 100)} onChange={event => setExploration(Number(event.target.value) / 100)}/>
        <div className="v3-scale-labels"><span>Keep it familiar</span><span>Take me somewhere new</span></div>
        <p>{curiosityUnknown ? 'No curiosity preference recorded. The existing recommendation engine uses a neutral 50/100 default until you choose.' : 'Your usual openness to novelty helps order strong taste matches. Within-target dishes come first; above-target alternatives are labeled. Dietary and allergy safeguards always apply.'}</p>
      </section>
      <section className="v3-inference-card"><span className="v3-overline">READING BETWEEN THE BITES</span><h3>Possibilities, not conclusions.</h3>
        {reading?.observations.length ? reading.observations.map(observation => <p key={observation}>{observation}</p>) : <p>We’ll keep this space open until your answers offer more clues. A favorite dish alone doesn’t define your palate.</p>}
        <span className="v3-inference-count">{direct} dimensions with direct or edited evidence · {known - direct} {reading ? 'tentative' : 'previously saved'}</span>
      </section></div>
    </div>
    <section className="v3-lasting-preferences"><div><span className="v3-overline">YOUR ESSENTIALS, ALWAYS SEPARATE</span><h2>Care is part of good taste.</h2><p>These preferences persist across restaurants. They never come from our sensory inferences.</p></div>
      <div><DietaryControls value={constraints.dietary_restrictions} onChange={dietary_restrictions => setConstraints({ ...constraints, dietary_restrictions })}/>
        <AllergyControls value={constraints.allergies} onChange={allergies => setConstraints({ ...constraints, allergies })}/></div></section>
    <div className="v3-context-note"><Icon name="sun" size={23}/><div><strong>Your DNA is the through line. Tonight has its own mood.</strong><p>Budget, appetite, and restaurant-specific cravings live in the menu filters. Changing them won’t rewrite this sensory profile.</p></div></div>
    <section className="v3-dna-next"><div><Eyebrow>YOUR NEXT CHAPTER</Eyebrow><h2>Let’s find something <em>you’ll love.</em></h2><p>Choose a restaurant, explore its complete menu, then discover your picks.</p></div>
      {demoNavigation ? <button type="button" className="button button-primary" onClick={demoNavigation.explore}>Find a restaurant <Icon name="arrow" size={17}/></button>
        : <ButtonLink href="/discover">Find a restaurant <Icon name="arrow" size={17}/></ButtonLink>}</section>
  </main>;
}
