'use client';
import { useDineTuned } from '../../components/AppProvider';
import { ButtonLink, Eyebrow, Icon } from '../../components/UI';

const capabilities = [
  { title: 'Taste Detective', state: 'YOUR CHOICES', icon: 'message' as const, text: 'Explicit flavor and texture choices create an editable Taste DNA. Muse does not generate this profile. Free text is saved as context; it is not interpreted by a live model.' },
  { title: 'Restaurants & menus', state: 'VERIFIED BRANCH · SOURCE-BASED MENU', icon: 'book' as const, text: 'When owner-approved, Google Places confirms the exact restaurant branch. DineTuned can read supported public HTML and text-PDF menu sources or a user-supplied document. Uploads remain labeled unverified; scanned images are not extracted yet. Fictional demo menus are separate.' },
  { title: 'Personal picks', state: 'META MUSE SPARK 1.3', icon: 'compass' as const, text: 'For an approved signed real menu, Muse Spark 1.3 proposes dish choices and taste/evidence connections from Taste DNA and supplied menu text. Python validates IDs, identity, prices, restrictions and allergies, then assembles the visible explanations. The fictional demo replays fixture results.' },
  { title: 'Diet & allergy handling', state: 'SEPARATE BY DESIGN', icon: 'shield' as const, text: 'Dietary preferences combine. Unknown ingredient or cross-contact information excludes dishes when an allergy is selected. No allergy safety is certified.' },
  { title: 'Food imagery', state: 'META MUSE IMAGE 1.0', icon: 'camera' as const, text: 'Muse Image 1.0 can turn source-linked dish names and menu descriptions into privately cached illustrations for approved real Picks. Images are labeled illustrative, never restaurant photography; the offline demo uses local sample imagery.' },
  { title: 'Dining memories', state: 'LOCAL + OPTIONAL CLOUD', icon: 'history' as const, text: 'Local records remain available. With Supabase configured, your guest identity supports private dining history, feedback and explicit Taste DNA backup and recovery. No model retraining or automatic feedback learning runs yet.' },
];
export default function HowItWorks() {
  const { reset, taste } = useDineTuned();
  return <main className="content-width page-padding"><div className="tech-header"><Eyebrow>TRANSPARENT BY DESIGN</Eyebrow><h1>Thoughtful by design.<br/><em>Honest by default.</em></h1>
    <p>What works today, and where DineTuned’s intelligence goes next.</p></div>
    <section id="what-powers-this" className="meta-workflow" aria-label="What powers DineTuned"><div className="meta-workflow-heading"><Eyebrow>WHAT POWERS THIS</Eyebrow><h2>From your palate to <em>your plate.</em></h2><p>Two Meta models bring culinary intelligence and menu-inspired imagery to the real restaurant journey. DineTuned keeps the facts, safety checks and memory in its own hands.</p></div>
      <ol className="meta-workflow-steps"><li><span>01</span><strong>Your Taste DNA + menu</strong><small>Your choices and source-linked dishes, prices and descriptions.</small></li>
        <li><span>02</span><strong>Muse Spark 1.3</strong><small>Proposes personal dish matches and grounded culinary connections.</small></li>
        <li><span>03</span><strong>DineTuned checks</strong><small>Python enforces menu identity, evidence, allergies, diet and budget math.</small></li>
        <li><span>04</span><strong>Your Picks + Muse Image 1.0</strong><small>Validated Picks appear first; approved images arrive separately and are cached.</small></li>
        <li><span>05</span><strong>Taste Memory</strong><small>Your saved choices and feedback stay private; they do not retrain a model.</small></li></ol>
      <details className="meta-workflow-detail"><summary>What the models receive—and what the demo replays</summary><div><p><strong>Muse Spark receives</strong> a bounded Taste DNA, constraints, selected restaurant and source-linked menu item IDs with evidence. It proposes; application code accepts or rejects each claim and dish.</p>
        <p><strong>Muse Image receives</strong> an approved Pick’s actual dish name and supported menu description. Its output is an illustration, not a restaurant photograph. Generated assets are privately cached.</p>
        <p><strong>The offline demo</strong> uses a fictional menu, prepared validated Picks and local sample imagery. Its Test Kitchen sequence visualizes the workflow; it makes no Meta or Google request.</p></div></details></section>
    <div className="tech-status"><span className="status-dot"/><strong>Offline demo available · live integrations require configuration</strong><p>The guided demo runs without a backend or provider keys. Real restaurant search, private cloud history and Meta requests need their services configured; paid calls also require owner-enabled bounded access. Browsing and restoring cached Picks do not call paid providers. Feedback is not interpreted by a model automatically.</p></div>
    <div className="tech-grid">{capabilities.map(item => <article className="tech-card" key={item.title}><div className="tech-icon"><Icon name={item.icon} size={26}/></div><span className="tech-status-pill">{item.state}</span><h2>{item.title}</h2><p>{item.text}</p></article>)}</div>
    <div className="tech-cta"><div><h2>Your table, with its sources in view.</h2><p>Explore a real menu when provider access is approved, or try the clearly labeled fictional demo. In either mode, unknown ingredients and unverified allergy safety stay visible.</p></div>
      <div className="tech-actions"><ButtonLink href={taste.complete ? '/discover' : '/onboarding'}>Explore the experience <Icon name="arrow" size={17}/></ButtonLink>
        <button className="button button-outline" onClick={() => { if (window.confirm('Reset your local profile and meal memories?')) { reset(); window.location.href = '/'; } }}><Icon name="reset" size={17}/> Reset demo</button></div></div>
  </main>;
}
