'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ButtonLink, Eyebrow, Icon } from '../components/UI';
import { DishArt } from '../components/DishArt';
import { useDineTuned } from '../components/AppProvider';
import { LoadingState } from '../components/AsyncState';

export default function Welcome() {
  const { taste, ready } = useDineTuned();
  const router = useRouter();
  useEffect(() => { if (ready && taste.complete) router.replace('/discover'); }, [ready, taste.complete, router]);
  if (!ready) return <LoadingState label="Restoring your saved taste…"/>;
  if (taste.complete) return <LoadingState label="Let’s find your restaurant…"/>;
  return <main>
    <section className="welcome-hero content-width"><div className="welcome-copy"><Eyebrow>FINE-TUNED TO YOUR TASTE</Eyebrow><h1>Fall in love<br/>with <em>what’s</em><br/>on the menu.</h1>
      <p className="lead">Your taste is personal. Your next great meal should be, too. Discover a dining concierge built around the things you love.</p>
      <div className="hero-buttons"><ButtonLink href="/onboarding">Find my taste <Icon name="arrow" size={18}/></ButtonLink><ButtonLink href="/demo" variant="outline">Try DineTuned Demo <Icon name="play" size={17}/></ButtonLink><ButtonLink href="/how-it-works" variant="outline">Meet DineTuned <Icon name="compass" size={17}/></ButtonLink></div>
      <div className="hero-foot"><Icon name="spark" size={17}/><span>Personalized with Meta Muse when live inference is approved. <a href="/how-it-works#what-powers-this">See how it works</a></span></div></div>
      <div className="welcome-art welcome-v2-art"><DishArt name="Your next favorite meal" seed="dinetuned-welcome" media={{ kind: 'placeholder', motif: 'noodles', accent: '#d8e2cf', label: 'Illustrated placeholder' }}/>
        <div className="floating-cream floating-top"><div className="mini-icon"><Icon name="brain" size={20}/></div><div><strong>Taste Detective</strong><span>Start with what you love</span></div></div>
        <div className="floating-cream floating-bottom"><div className="mini-bubble">✦</div><div><strong>Your next favorite?</strong><span>A little curiosity looks good on you.</span></div></div>
      </div></section>
    <section className="feature-strip content-width"><div><span className="feature-no">01</span><Icon name="message" size={23}/><h3>Find your flavor</h3><p>A few guided choices build your editable Taste DNA.</p></div>
      <div><span className="feature-no">02</span><Icon name="book" size={23}/><h3>Explore the whole menu</h3><p>Every category, with your budget and needs in focus.</p></div>
      <div><span className="feature-no">03</span><Icon name="spark" size={23}/><h3>Make it personal</h3><p>Up to three thoughtful picks, with the reasons behind them.</p></div></section>
    <section className="explainer-section content-width"><div><Eyebrow>A SMALL PREVIEW OF WHAT’S NEXT</Eyebrow><h2>Every taste has<br/>a <em>starting point.</em></h2>
      <p>The cinematic DineTuned introduction will live here. For now, explore the guided experience, with real restaurants when search is approved and a separate labeled demo.</p><ButtonLink href="/onboarding" variant="outline">Start your food story <Icon name="arrow" size={17}/></ButtonLink></div>
      <div className="explainer-reserved" aria-label="Reserved space for a future cinematic explainer video"><span className="film-corner top-left"/><span className="film-corner bottom-right"/>
        <span className="explainer-symbol" aria-hidden="true">d.</span><span>THE DINETUNED STORY</span><p>Cinematic introduction · coming later</p></div>
    </section>
    <section className="closing-cta content-width"><div><Eyebrow>YOUR NEXT FAVORITE IS OUT THERE</Eyebrow><h2>The menu is full of possibilities.</h2><p>Let’s find the ones that feel like you.</p></div><ButtonLink href="/onboarding" variant="white">Let’s begin <Icon name="arrow" size={18}/></ButtonLink></section>
  </main>;
}
