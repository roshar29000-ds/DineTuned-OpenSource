'use client';
import { useDineTuned } from './AppProvider';
import { ButtonLink, Icon } from './UI';
import type { ReactNode } from 'react';

export function ProfileGate({ children }: { children: ReactNode }) {
  const { taste, ready } = useDineTuned();
  if (!ready) return <main className="content-width page-padding"><div className="empty-wide" role="status"><h1>Returning to your taste.</h1><p>Restoring your saved Taste DNA and dining context.</p></div></main>;
  if (!taste.complete) return <main className="content-width page-padding"><div className="empty-wide">
    <Icon name="heart" size={32}/><h1>Let’s start with your taste.</h1>
    <p>A few guided choices create your Taste DNA. Then explore the full menu and set your filters before seeing your picks.</p>
    <ButtonLink href="/onboarding">Meet Taste Detective <Icon name="arrow" size={17}/></ButtonLink>
  </div></main>;
  return children;
}
