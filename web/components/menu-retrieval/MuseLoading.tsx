'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MenuExtractionResult, TasteProfile } from '../../lib/contracts';
import { axisLabels, axisNames, money } from '../../lib/preferences';

/** Time from a real result to the Picks page: the ring closes, then the plate opens into the page's ivory. */
export const ORBIT_HANDOFF_MS = 1500;

/** The opening timeline, in seconds. After it the dishes keep circling for as long as the request takes. */
const ENTER = { start: .7, stagger: .38, length: 2.4 };
const MORPH = { start: 5.6, stagger: .6, length: 1.6 };
const WORDS: [number, string][] = [[0, 'Reading the menu'], [4.2, 'Considering your taste'], [8.8, 'Curating your picks']];
const STILL_WORKING_MS = 24000;
const MAX_CARDS = 8, MAX_DISHES = 5;

const MEAT_NAME = /chicken|steak|lamb|goat|duck|pork|beef|rib\b|ribs|shank|belly|brisket|burger|veal/i;
const SWEET_NAME = /cake|tart|gelato|panna|galette|cheesecake|dessert|sweet|ice cream|chocolate/i;
const MEAT = /beef|steak|brisket|burger|pork|pig|bacon|\bham\b|sausage|chorizo|lamb|goat|chicken|duck|veal|liver/i;
const FISH = /fish|salmon|hamachi|dorade|shrimp|tuna|cod\b|anchovy|scallop|crab/i;

type OrbitDish = { name: string; category: string; note: string; price: string | null };
export type OrbitScene = { restaurant: string; dishCount: number; dishes: OrbitDish[]; mode: 'meta' | 'mock' | 'disabled'; tasteNotes?: string[]; preview?: boolean; film?: boolean };

function allowed(text: string, taste: TasteProfile) {
  const rules = (taste.dietary_restrictions || []).map(rule => String(rule).toLowerCase());
  if (rules.some(rule => /beef/.test(rule)) && /beef|steak|brisket|burger/i.test(text)) return false;
  if (rules.some(rule => /pork/.test(rule)) && /pork|pig|bacon|\bham\b|sausage|chorizo/i.test(text)) return false;
  if (rules.some(rule => /vegetarian|vegan|pescatarian/.test(rule)) && MEAT.test(text)) return false;
  if (rules.some(rule => /vegetarian|vegan/.test(rule)) && FISH.test(text)) return false;
  const allergies = [...(taste.allergies?.allergens || []).map(allergen => String(allergen).replace(/_/g, ' ')), ...(taste.allergies?.other || '').split(/[;,]/)];
  return !allergies.some(allergy => allergy.trim().length > 2 && text.toLowerCase().includes(allergy.trim().toLowerCase()));
}

export function sceneFromMenu(menu: MenuExtractionResult, taste: TasteProfile, mode: OrbitScene['mode']): OrbitScene {
  // A spread across the menu, so the cards hint at no winner. Dishes the guest excludes never orbit.
  const rows = menu.menu.categories.map(category => category.items.map(item => ({ item, category: category.name })).filter(({ item }) => allowed(`${item.name} ${item.description || ''}`, taste)));
  const spread: typeof rows[number] = [];
  for (let i = 0; spread.length < MAX_CARDS && rows.some(list => i < list.length); i++) rows.forEach(list => { if (list[i] && spread.length < MAX_CARDS) spread.push(list[i]); });
  const dishes = spread.map(({ item, category }) => ({ name: item.name, category, note: item.description?.slice(0, 100) || '',
    price: item.price.budget_usable && item.price.options[0]?.currency === 'USD' && item.price.kind === 'fixed' ? money(item.price.options[0].amount_minor) : null }));
  const tasteNotes = axisNames.filter(axis => (taste.axes[axis] ?? 0) >= .65).slice(0, 3).map(axis => axisLabels[axis]);
  return { restaurant: menu.menu.restaurant.display_name, dishCount: menu.menu.total_items, dishes, tasteNotes, mode };
}

/** An assortment, not a verdict. Chicken only appears when a card actually names meat, so an excluded food never orbits as a picture. */
function assignArt(dishes: OrbitDish[]) {
  const pool = ['greens', 'rice', 'soup', 'tart'], used = new Set<string>();
  return dishes.map(dish => {
    const wish = MEAT_NAME.test(dish.name) ? 'chicken' : SWEET_NAME.test(dish.name) ? 'tart' : '';
    const art = (wish && !used.has(wish) ? wish : pool.find(name => !used.has(name))) || pool[used.size % pool.length];
    used.add(art);
    return art;
  });
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, value: number) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const outCubic = (t: number) => 1 - (1 - t) ** 3;

export function CulinaryOrbit({ scene, ready = false, error = null, clean = false, modal = true, onLeave, onSkip, onRetry, onBack }: {
  scene: OrbitScene; ready?: boolean; error?: string | null; clean?: boolean; modal?: boolean;
  onLeave?: () => void; onSkip?: () => void; onRetry?: () => void; onBack?: () => void;
}) {
  const [word, setWord] = useState(0);
  const [slow, setSlow] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const heading = useRef<HTMLHeadingElement>(null), retry = useRef<HTMLButtonElement>(null);
  const turn = useRef<HTMLImageElement>(null), gold = useRef<HTMLDivElement>(null);
  const orbs = useRef<(HTMLDivElement | null)[]>([]);
  const motion = useRef({ ready, failed: !!error });
  motion.current = { ready, failed: !!error };
  const art = useMemo(() => assignArt(scene.dishes), [scene]);
  const working = !ready && !error;

  // Open from the button that was pressed. Read before focus moves.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.tagName === 'BUTTON') { const box = active.getBoundingClientRect(); setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 }); }
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (error) retry.current?.focus({ preventScroll: true }); }, [error]);
  useEffect(() => {
    if (!working) return;
    const timers = WORDS.slice(1).map(([at], i) => setTimeout(() => setWord(i + 1), at * 1000));
    const late = setTimeout(() => setSlow(true), STILL_WORKING_MS);
    return () => { timers.forEach(clearTimeout); clearTimeout(late); };
  }, [working]);

  // One clock moves everything. React only re-renders for words and states.
  useEffect(() => {
    const host = stage.current, ctx = canvas.current?.getContext('2d');
    if (!host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, last = performance.now(), orbit = -Math.PI / 2 + .3, plateAngle = 0, ringAngle = -120, leave = 0, nextZones = 0;
    const start = last;
    let W = 0, H = 0, cx = 0, cy = 0, plate = 0, dish = 0, cardW = 0, cardH = 0, rxCard = 0, ryCard = 0, rxDish = 0, ryDish = 0, cards = 0, dishes = 0;
    let zones: { l: number; t: number; r: number; b: number; dx: number; dy: number }[] = [];
    const parts = orbs.current.map(orb => orb ? { paper: orb.querySelector<HTMLElement>('.co-paper'), face: orb.querySelector<HTMLElement>('.co-face'), img: orb.querySelector<HTMLElement>('.co-dish'), sweep: orb.querySelector<HTMLElement>('.co-sweep') } : null);
    const measure = () => {
      W = host.clientWidth; H = host.clientHeight;
      const small = W < 700, dpr = Math.min(1.5, window.devicePixelRatio || 1);
      plate = small ? Math.min(W * .58, H * .34) : Math.min(H * .6, W * .38);
      dish = small ? Math.max(54, plate * .3) : Math.max(84, plate * .265);
      cx = W / 2; cy = H * (small ? .46 : .5);
      cardW = small ? Math.min(128, W * .38) : Math.max(186, Math.min(W * .155, 300)); cardH = small ? 50 : cardW * .36;
      ryDish = small ? plate / 2 + dish * .95 : Math.min(H / 2 - dish / 2 - 6, plate / 2 + dish / 2 + plate * .045);
      rxDish = small ? W / 2 - dish / 2 - 5 : Math.min(ryDish * 1.34, W / 2 - dish / 2 - 16);
      rxCard = small ? W / 2 - cardW / 2 - 6 : Math.min(W / 2 - cardW / 2 - 14, rxDish * 1.26);
      ryCard = small ? H * .31 : Math.min(H / 2 - cardH / 2 - 8, ryDish);
      cards = small ? Math.min(6, scene.dishes.length) : scene.dishes.length;
      dishes = Math.min(MAX_DISHES, Math.ceil(cards * .75));
      root.current?.style.setProperty('--co-p', `${plate}px`);
      root.current?.style.setProperty('--co-cy', `${cy}px`);
      root.current?.style.setProperty('--co-d', `${dish * 1.04}px`);
      root.current?.style.setProperty('--co-iris', String(2.1 * Math.hypot(W, H) / plate));
      if (canvas.current) { canvas.current.width = W * dpr; canvas.current.height = H * dpr; ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); }
      orbs.current.forEach((orb, i) => { if (orb) orb.style.display = i < cards ? '' : 'none'; });
      nextZones = 0;
    };
    // The corners hold the words. An orbiter reaching one is eased inward, continuously, so nothing sits on the type.
    const readZones = () => {
      zones = ([['.co-brand', 1, 1], ['.co-choices', -1, 1], ['.co-credit', -1, -1]] as const).flatMap(([selector, dx, dy]) => {
        const box = root.current?.querySelector(selector)?.getBoundingClientRect();
        return box ? [{ l: box.left - 12, t: box.top - 12, r: box.right + 12, b: box.bottom + 12, dx, dy }] : [];
      });
    };
    const paint = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000), t = (now - start) / 1000;
      last = now;
      const { ready: done, failed } = motion.current;
      if (now >= nextZones) { readZones(); nextZones = now + 900; }
      leave = reduced ? (done || failed ? 1 : 0) : lerp(leave, done || failed ? 1 : 0, Math.min(1, dt * (done ? 3.4 : 2.6)));
      if (!reduced) {
        orbit += dt * (.21 + (done ? .55 * leave : 0)) * (failed ? 1 - leave : 1);
        plateAngle += dt * 1.3 * (failed ? 1 - leave : 1);
        ringAngle += dt * (failed ? 12 : 58 + Math.sin(t * .6) * 12);
      }
      if (turn.current) turn.current.style.transform = `rotate(${plateAngle}deg)`;
      if (gold.current) gold.current.style.transform = `rotate(${ringAngle}deg)`;
      if (ctx) ctx.clearRect(0, 0, W, H);
      const span = MORPH.stagger * Math.max(0, dishes - 1) + MORPH.length, gather = reduced ? 0 : outCubic(clamp01((t - MORPH.start) / span));
      if (ctx && !reduced) {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(226,185,95,${.16 * gather * (1 - leave)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(cx, cy, rxDish, ryDish, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < cards; i++) {
        const orb = orbs.current[i], part = parts[i];
        if (!orb || !part) continue;
        const becomes = i < dishes;
        const enter = reduced ? 1 : outCubic(clamp01((t - ENTER.start - i * ENTER.stagger) / ENTER.length));
        const m = reduced || !becomes ? 0 : smooth(0, 1, (t - MORPH.start - i * MORPH.stagger) / MORPH.length);
        const gone = reduced || becomes ? 0 : smooth(0, 1, (t - MORPH.start - (i - dishes) * MORPH.stagger - .4) / 1.8);
        const slot = lerp(i / cards, becomes ? i / dishes : i / cards, gather);
        const spiral = (1 - enter) * (i % 2 ? 1.5 : -1.5);
        const a = orbit + slot * Math.PI * 2 + spiral;
        const push = 1 + (1 - enter) * 1.7 + gone * 1.2 + leave * .32;
        let x = cx + Math.cos(a) * lerp(rxCard, rxDish, m) * push, y = cy + Math.sin(a) * lerp(ryCard, ryDish, m) * push;
        const depth = (Math.sin(a) + 1) / 2, s = reduced ? 1 : .93 + depth * .09;
        const w = lerp(cardW, dish, m), h = lerp(cardH, dish, m);
        zones.forEach(zone => {
          const over = Math.min(zone.dx > 0 ? zone.r - (x - w * s / 2) : x + w * s / 2 - zone.l, zone.dy > 0 ? zone.b - (y - h * s / 2) : y + h * s / 2 - zone.t);
          if (over > 0) { x += zone.dx * over; y += zone.dy * over; }
        });
        const tilt = (reduced ? (i % 2 ? 1.6 : -1.6) : Math.cos(a) * -3 + (1 - enter) * (i % 2 ? 16 : -16)) * (1 - m);
        orb.style.width = `${w}px`; orb.style.height = `${h}px`; orb.style.borderRadius = `${lerp(4, dish / 2, m)}px`;
        orb.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${tilt}deg) scale(${s})`;
        orb.style.opacity = String(enter * (1 - gone) * (1 - leave) * lerp(.8 + depth * .2, 1, m));
        orb.style.zIndex = String(14 + Math.round(depth * 5));
        if (part.paper) part.paper.style.opacity = String(1 - smooth(.55, .95, m));
        if (part.face) part.face.style.opacity = String(1 - smooth(0, .42, m));
        if (part.img) { part.img.style.opacity = String(smooth(.28, .78, m)); part.img.style.transform = `rotate(${(orbit + i) * 40}deg) scale(${lerp(.74, 1, m)})`; }
        if (part.sweep) part.sweep.style.opacity = String(Math.sin(Math.PI * m) * .9);
        // A trail of gold follows each dish; while a card turns, a brighter wake streams behind it.
        if (ctx && !reduced && m > .02) {
          const wake = Math.sin(Math.PI * m), length = .5 + wake * .55, alpha = Math.max(m, wake) * (1 - leave);
          for (const [offset, width, strength] of [[1.04, 2, 1], [1.04, 7, .3], [1.1, 1.2, .5]] as const) {
            for (let k = 0; k < 16; k++) {
              const u = k / 16, from = a - length * (1 - u), to = a - length * (1 - (k + 1) / 16);
              ctx.strokeStyle = `rgba(236,197,110,${strength * u * u * alpha})`; ctx.lineWidth = width;
              ctx.beginPath(); ctx.ellipse(cx, cy, rxDish * offset, ryDish * offset, 0, from, to); ctx.stroke();
            }
          }
        }
      }
      if (!reduced) raf = requestAnimationFrame(paint);
    };
    measure();
    const observer = new ResizeObserver(() => { measure(); if (reduced) requestAnimationFrame(paint); });
    observer.observe(host);
    raf = requestAnimationFrame(paint);
    repaint.current = () => { if (reduced) requestAnimationFrame(paint); };
    return () => { cancelAnimationFrame(raf); observer.disconnect(); repaint.current = null; };
  }, [scene]);
  const repaint = useRef<(() => void) | null>(null);
  useEffect(() => { repaint.current?.(); }, [ready, error]);

  // Keep keyboard focus inside the dialog; Escape is the same as leaving.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && modal) { (error ? onBack : onLeave)?.(); return; }
    if (event.key !== 'Tab' || !modal) return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('button') || [])];
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const museVoice = scene.mode === 'meta' || scene.preview;
  const attribution = scene.preview ? 'FICTIONAL FIXTURE · OFFLINE REPLAY · MUSE SPARK WORKFLOW' : scene.mode === 'meta' ? 'Powered by Meta Muse Spark' : 'OFFLINE DEMO · NO MODEL REQUEST';
  const notPicks = 'Dishes shown are from the menu, not your Picks or dietary approval. Plates are AI-generated illustrations.';
  const truth = ready ? (scene.preview || scene.film ? 'Replay only. No model request.' : 'Validated Picks received.')
    : scene.film ? `Replay of this restaurant’s menu. No model request during this animation. ${notPicks}`
    : scene.preview ? `Offline fictional replay of the Meta-powered workflow · no provider request or guest data. ${notPicks}` : notPicks;
  const style = origin ? { '--co-ox': `${origin.x}px`, '--co-oy': `${origin.y}px` } as React.CSSProperties : undefined;

  return <div ref={root} className={`co-root${ready ? ' is-ready' : ''}${error ? ' is-error' : ''}`} style={style} role="dialog" aria-modal={modal} aria-label="Personalized Picks are being prepared" aria-busy={working} onKeyDown={onKeyDown}>
    <div className="co-table" aria-hidden="true"/><div className="co-light" aria-hidden="true"/>
    <div className="co-stage" ref={stage}>
      <canvas ref={canvas} className="co-trails" aria-hidden="true"/>
      <div className="co-plate" aria-hidden="true"><div className="co-plate-shadow"/><img ref={turn} className="co-plate-turn" src="/culinary-orbit/plate.webp" alt=""/><img className="co-plate-gloss" src="/culinary-orbit/plate-gloss.webp" alt=""/></div>
      <div ref={gold} className="co-gold" aria-hidden="true"><i className="co-gold-bloom"/><i className="co-gold-band"/><i className="co-gold-head"/></div>
      <div className="co-gold-full" aria-hidden="true"/>
      {scene.dishes.map((dish, i) => <div key={`${dish.name}-${i}`} ref={el => { orbs.current[i] = el; }} className="co-orb" aria-hidden="true">
        <div className="co-paper"/><img className="co-dish" src={`/culinary-orbit/dish-${art[i]}.webp`} alt=""/><i className="co-sweep"/>
        <div className="co-face"><span>{dish.category}</span><strong>{dish.name}</strong>{dish.note && <small>{dish.note}</small>}{dish.price && <b>{dish.price}</b>}</div></div>)}
    </div>
    <div className="co-center">
      <h2 ref={heading} tabIndex={-1}>{error ? <span className="co-big">The kitchen paused</span> : ready ? <><span className="co-lead">{museVoice ? 'Muse has finished' : 'Finished'}</span> <span className="co-big">Your picks are ready</span></> :
        <><span className="co-lead">{museVoice ? 'Muse is cooking up' : 'Cooking up'}</span> <span className="co-big">your picks</span></>}</h2>
      {!error && <div className="co-wait" aria-hidden="true"><i/><i/><i/></div>}
      <p key={ready ? 'ready' : error ? 'error' : slow ? 'slow' : word} className="co-stage-word" style={{ margin: 0 }} role="status">{error ? 'Your choices are safe' : ready ? 'Setting your table' : slow ? 'Still composing' : WORDS[word][1]}</p>
    </div>
    <div className="co-brand">Muse’s Culinary Orbit<small>{scene.restaurant} · {scene.dishCount} dishes</small>{!!scene.tasteNotes?.length && <small>Your palate · {scene.tasteNotes.join(' · ')}</small>}</div>
    {!clean && !error && (onLeave || onSkip) && <div className="co-choices">{onLeave && <button type="button" className="co-quiet" onClick={onLeave}>Keep browsing the menu</button>}
      {onSkip && <button type="button" className="co-quiet" onClick={onSkip}>Open sample Picks now →</button>}</div>}
    {!error && <div className="co-credit"><strong>{attribution}</strong>{scene.mode === 'meta' && !scene.preview && <span>Personalized culinary reasoning</span>}<em>{truth}</em></div>}
    {error && <div className="co-error" role="alert"><p>{error}</p><p>No automatic retry was made. Your taste, budget and refinements are unchanged.</p>
      <div className="co-error-actions"><button ref={retry} type="button" className="co-retry" onClick={onRetry}>Try again</button><button type="button" className="co-back" onClick={onBack}>Back to the menu</button></div></div>}
    <div className="co-iris" aria-hidden="true"/>
  </div>;
}

export function MuseLoading({ menu, taste, mode, ready, error, onLeave, onRetry, onBack }: {
  menu: MenuExtractionResult; taste: TasteProfile; mode: OrbitScene['mode']; ready?: boolean; error?: string | null; onLeave: () => void; onRetry: () => void; onBack: () => void;
}) {
  const scene = useMemo(() => sceneFromMenu(menu, taste, mode), [menu, taste, mode]);
  return <CulinaryOrbit scene={scene} ready={ready} error={error} onLeave={onLeave} onRetry={onRetry} onBack={onBack}/>;
}
