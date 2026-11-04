'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TasteProfile } from '../../lib/contracts';
import { apiRequest } from '../../lib/api';
import { axisNames } from '../../lib/preferences';
import { activeSteps, answerSummary, choose, newDraft, stepLabels, type DetectiveDraft, type StepId } from '../../lib/detective/model';
import { demoDetective, enrichProfile, previewProfile, questionFor, responseTo, suggestedReasons, toTasteAnswers } from '../../lib/detective/engine';
import { initialTaste } from '../../lib/preferences';
import { useDineTuned } from '../AppProvider';
import { AllergyControls, DietaryControls } from '../menu/PreferenceControls';
import { Eyebrow, Icon } from '../UI';
import { SensoryMap } from './SensoryMap';
import { ChoiceTiles } from './ChoiceTiles';

export function TasteDetective({ onDemoComplete, onDemoBack }: { onDemoComplete?: (profile: TasteProfile) => void; onDemoBack?: () => void } = {}) {
  const router = useRouter();
  const { taste, detective, detectiveDraft, setDetectiveDraft, saveDetective } = useDineTuned();
  const [draft, setDraft] = useState(() => detectiveDraft || newDraft(taste, detective));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const firstRender = useRef(true);
  const steps = activeSteps(draft.answers), step = draft.current, index = steps.indexOf(step);
  const reading = demoDetective.analyze(draft.answers), profile = previewProfile(reading);
  const known = axisNames.filter(axis => profile.axes[axis] !== null).length;
  const question = questionFor(step, draft.answers);
  const previous = steps.filter(id => draft.visited.includes(id) && id !== step && id !== 'review');
  const lastNote = steps.slice(0, index).filter(id => draft.visited.includes(id)).at(-1);
  const reply = responseTo(step, draft.answers);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [step]);
  function update(next: DetectiveDraft) { setDraft(next); setDetectiveDraft(next); setError(''); }
  function edit(id: StepId) { setEditing(step === 'review' || editing); update({ ...draft, current: id }); }
  function advance(skip = false) {
    let next = draft;
    if (skip && step !== 'review' && step !== 'boundaries') {
      next = { ...draft, answers: { ...draft.answers, choices: { ...draft.answers.choices, [step]: [], ...(step === 'ingredients' ? { avoids: [] } : {}) } } };
      if (!activeSteps(next.answers).includes('aromatics')) next.answers.choices.aromatics = [];
    }
    const path = activeSteps(next.answers);
    update({ ...next, visited: [...new Set([...next.visited, step])].filter(id => path.includes(id)),
      current: editing ? 'review' : path[Math.min(path.indexOf(step) + 1, path.length - 1)] });
    setEditing(false);
  }
  async function publish() {
    setSaving(true); setError('');
    if (onDemoComplete) {
      const answers = toTasteAnswers(draft.answers, reading);
      const profile = enrichProfile({ ...initialTaste(), complete: true, favorites: answers.favorites,
        dietary_restrictions: answers.dietary_restrictions, allergies: answers.allergies,
        updated_at: new Date().toISOString() }, reading);
      saveDetective(profile, { version: 3, engine: reading.engine, answers: draft.answers, savedAt: new Date().toISOString() });
      onDemoComplete(profile); setSaving(false); return;
    }
    request.current = new AbortController();
    try {
      const result = await apiRequest<TasteProfile>('taste/profile', 'TasteProfile', toTasteAnswers(draft.answers, reading), request.current.signal);
      saveDetective(enrichProfile(result, reading), { version: 3, engine: reading.engine, answers: draft.answers, savedAt: new Date().toISOString() });
      router.push('/taste');
    } catch (error) {
      if (request.current.signal.aborted) return;
      setError(error instanceof Error ? error.message : 'Please try again.'); setSaving(false);
    }
  }
  return <main className="v3-taste v3-detective content-width page-padding">
    <header className="v3-page-heading"><div><Eyebrow>THE ART OF KNOWING YOUR TASTE</Eyebrow><h1>Good taste.<br/><em>Entirely yours.</em></h1>
      <p>A conversation about the food you come back to.<br className="v3-desktop-break"/> Follow your instincts. We’ll follow the clues.</p></div>
      <div className="v3-edition"><span>THE TASTE JOURNAL</span><strong>01 / Discover</strong><span>Guided demo · no live AI</span></div>
    </header>
    <div className="v3-detective-layout">
      <section className="v3-conversation" aria-label="Taste Detective conversation">
        <div className="v3-conversation-top"><div className="v3-agent"><span className="v3-agent-mark"><Icon name="spark" size={22}/></span><div><strong>Taste Detective</strong><span>Your personal tasting companion</span></div></div>
          <span className="v3-chapter-count">{String(index + 1).padStart(2, '0')} <span>/ {steps.length}</span></span></div>
        <div className="v3-progress" role="progressbar" aria-label="Taste Detective progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={index + 1}>
          {steps.map((id, i) => <span key={id} className={i <= index ? 'filled' : ''}/>)}</div>
        {previous.length > 0 && <details className="v3-answer-drawer"><summary><Icon name="history" size={15}/> Your answers <span>{previous.length} notes · tap to revisit</span></summary>
          <div>{previous.map(id => <button key={id} disabled={saving} onClick={() => edit(id)} aria-label={`Edit ${stepLabels[id]}`}><strong>{stepLabels[id]}</strong><span>{answerSummary(id, draft.answers)}</span><Icon name="chevron" size={15}/></button>)}</div>
        </details>}
        <fieldset className="v3-response-area" disabled={saving}>
          <legend className="sr-only">Your taste conversation responses</legend>
          <div className="v3-question" key={step}>
            {lastNote && step !== 'review' && <div className="v3-response-echo"><span>YOUR LAST NOTE</span><p>{answerSummary(lastNote, draft.answers)}</p></div>}
            {reply && <div className="v3-host-reply"><span aria-hidden="true">✧</span><p>{reply}</p></div>}
            <span className="v3-overline">{step === 'aromatics' ? 'A FOLLOW-UP, JUST FOR THIS CONVERSATION' : stepLabels[step]}</span>
            <h2 ref={heading} tabIndex={-1}>{question.title}</h2><p>{question.note}</p>
            {step === 'review' ? <div className="v3-review-list">{steps.filter(id => id !== 'review').map(id =>
              <button key={id} onClick={() => edit(id)} aria-label={`Revise ${stepLabels[id]}`}><span><strong>{stepLabels[id]}</strong><small>{answerSummary(id, draft.answers)}</small></span><Icon name="adjust" size={17}/></button>)}</div>
              : step === 'boundaries' ? <div className="v3-essentials"><DietaryControls value={draft.answers.dietary_restrictions}
                onChange={dietary_restrictions => update({ ...draft, answers: { ...draft.answers, dietary_restrictions } })}/>
                <AllergyControls value={draft.answers.allergies} onChange={allergies => update({ ...draft, answers: { ...draft.answers, allergies } })}/></div>
              : <>{step === 'ingredients' && <h3 className="v3-choice-group-title">Usually a yes</h3>}
                <ChoiceTiles choiceKey={step} value={draft.answers.choices[step]} onChoose={id => update(choose(draft, step, id))}
                  suggestions={step === 'reasons' ? suggestedReasons(draft.answers) : []}/>
                {step === 'ingredients' && <><h3 className="v3-choice-group-title">I’d prefer less of</h3><ChoiceTiles choiceKey="avoids" value={draft.answers.choices.avoids} onChoose={id => update(choose(draft, 'avoids', id))}/>
                  <p className="v3-small-note">Dislikes are saved as notes, not guaranteed menu exclusions. Add allergies in Your essentials.</p></>}
              </>}
            {(step === 'anchors' || step === 'contrast') && <p className="v3-art-note">Illustrated food prompts · not restaurant photographs</p>}
            {step === 'anchors' && <p className="v3-selection-note" role="status">{draft.answers.choices.anchors.length} of 3 favorites selected{draft.answers.choices.anchors.length === 3 ? ' · Tap one to make room for another' : ''}</p>}
          </div>
          {error && <p className="form-error" role="alert">{error} Your tasting notes are still here.</p>}
          <div className="v3-conversation-actions"><button className="v3-back" aria-label={editing ? 'Return to review' : 'Back'} onClick={() => {
            if (editing) { setEditing(false); update({ ...draft, current: 'review' }); }
            else if (index > 0) update({ ...draft, current: steps[index - 1] });
            else if (onDemoBack) onDemoBack();
            else router.push(taste.complete ? '/taste' : '/');
          }}><Icon name="left" size={17}/><span>{editing ? 'Review' : 'Back'}</span></button>
            {step !== 'review' && step !== 'boundaries' && <button className="v3-skip" onClick={() => advance(true)}>Leave open</button>}
            <button className="button button-primary" onClick={step === 'review' ? publish : () => advance()}>{saving ? 'Saving your Taste DNA…' : step === 'review' ? 'Create my Taste DNA' : editing ? 'Save answer' : 'Continue'}<Icon name="arrow" size={17}/></button>
          </div>
        </fieldset>
        <div className="v3-conversation-foot"><Icon name="shield" size={14}/><span>Saved in this browser as you go. Every answer is yours to change.</span></div>
      </section>
      <aside className="v3-detective-aside">
        <div className="v3-live-portrait"><div className="v3-overline">YOUR TASTE, TAKING SHAPE</div><h2>A little more <em>you.</em></h2>
          <SensoryMap axes={profile.axes} compact/>
          <div className="v3-portrait-foot"><span><b>{known}</b> of 7 sensory dimensions</span><span className="v3-live-dot">Demo preview</span></div>
          <p>Solid marks are clues. Open marks are questions we haven’t answered. Nothing here is a measured prediction.</p></div>
        <div className="v3-host-note"><span className="v3-overline">A NOTE FROM YOUR CONCIERGE</span><h3>{step === 'anchors' ? 'Start with a dish. Find your own details.' : known ? 'The interesting part is in the why.' : 'There’s room for a little mystery.'}</h3>
          <p>{step === 'anchors' ? 'Two people can love the same bowl of ramen for entirely different reasons. Let’s find yours.' : 'Your direct answers lead. Ingredient clues suggest possibilities, and unanswered dimensions stay unknown.'}</p>
          <div className="v3-note-rule"/><p><strong>Your taste is lasting.</strong><br/>Tonight’s craving, appetite, and budget belong at the restaurant menu. They don’t rewrite your DNA.</p>
          {taste.complete && <Link href="/taste" className="text-arrow">View saved DNA <Icon name="arrow" size={15}/></Link>}</div>
      </aside>
    </div>
  </main>;
}
