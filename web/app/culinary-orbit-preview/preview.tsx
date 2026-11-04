'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import fixture from '../../tests/fixtures/picks-preview.json';
import type { MenuExtractionResult, TasteProfile } from '../../lib/contracts';
import { CulinaryOrbit, ORBIT_HANDOFF_MS, sceneFromMenu } from '../../components/menu-retrieval/MuseLoading';
import { filmScene } from './film-scene';

// Fictional, sanitized fixtures, or the film scene. This preview never reads guest identity or calls an API.
const fixtureScene = { ...sceneFromMenu(fixture.extraction as MenuExtractionResult, fixture.profile as TasteProfile, 'mock'), preview: true };
/** When the simulated response arrives in the automatic takes. The full sequence is about 15 seconds. */
const TAKE_SECONDS = 13.5;
const PREVIEW_ERROR = 'This is a simulated failure. No request was made.';

export function OrbitPreview({ capture, film, readyAt, errorAt }: { capture: boolean; film: boolean; readyAt: number | null; errorAt: number | null }) {
  const router = useRouter();
  const clean = capture || film;
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const replay = () => { setReady(false); setError(null); setRun(value => value + 1); };
  const readyDelay = readyAt ?? (clean ? TAKE_SECONDS : null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (readyDelay !== null) timers.push(setTimeout(() => setReady(true), readyDelay * 1000));
    if (errorAt !== null) timers.push(setTimeout(() => setError(PREVIEW_ERROR), errorAt * 1000));
    return () => timers.forEach(clearTimeout);
  }, [readyDelay, errorAt, run]);
  useEffect(() => {
    if (!ready || film) return; // The film take rests on the page's ivory for the cut.
    const timer = setTimeout(() => router.push('/picks-preview#reveal'), ORBIT_HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [ready, film, router]);

  return <div className={clean ? 'capture-mode' : 'preview-mode'}>
    <CulinaryOrbit key={run} scene={film ? filmScene : fixtureScene} ready={ready} error={error} clean={clean} modal={false} onRetry={replay} onBack={replay}/>
    {!clean && <div className={`kitchen-preview-controls${controlsOpen ? ' is-open' : ''}`} aria-label="Offline preview controls">
      <button type="button" className="kitchen-preview-toggle" aria-expanded={controlsOpen} onClick={() => setControlsOpen(value => !value)}>Preview controls</button>
      <button type="button" onClick={replay}>Replay sequence</button>
      <button type="button" onClick={() => { setControlsOpen(false); setReady(true); }}>Simulate response ready</button>
      <button type="button" onClick={() => { setControlsOpen(false); setError(PREVIEW_ERROR); }}>Simulate error</button>
      <Link href="/culinary-orbit-preview?capture=1">Clean capture</Link>
      <Link href="/culinary-orbit-preview?film=1">Film take</Link>
    </div>}
  </div>;
}
