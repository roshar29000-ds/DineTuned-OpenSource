'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {type ReactNode} from 'react';
import {useDineTuned} from './AppProvider';
import {useIdentity} from './IdentityProvider';
import {leaveDemoExplore, restartDemo} from '../lib/demo-session';

type IconName='spark'|'arrow'|'chevron'|'location'|'search'|'heart'|'compass'|'book'|'user'|'menu'|'check'|'close'|'adjust'|'camera'|'clock'|'fork'|'brain'|'history'|'star'|'play'|'info'|'left'|'plus'|'sun'|'fire'|'leaf'|'shield'|'reset'|'message'|'grid';
const paths:Record<IconName,ReactNode>={
 spark:<><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/></>,
 arrow:<><path d="M4 12h16M13 5l7 7-7 7"/></>,chevron:<path d="m9 18 6-6-6-6"/>,location:<><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,heart:<path d="M20.8 4.6a5.2 5.2 0 0 0-7.4 0L12 6l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21l8.8-9a5.2 5.2 0 0 0 0-7.4Z"/>,compass:<><circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/></>,book:<><path d="M12 6C8 3 4 4 2 5v14c3-1 7-1 10 1 3-2 7-2 10-1V5c-2-1-6-2-10 1Zm0 0v14"/></>,user:<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7"/></>,menu:<path d="M3 6h18M3 12h18M3 18h18"/>,check:<path d="m4 12 5 5L20 6"/>,close:<path d="M5 5l14 14M19 5 5 19"/>,adjust:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/></>,camera:<><path d="M4 7h4l2-3h5l2 3h3v13H4V7Z"/><circle cx="12" cy="13" r="4"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,fork:<><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M18 21V3c-4 3-4 8-4 11h4"/></>,brain:<><path d="M12 5a4 4 0 0 0-7 2 4 4 0 0 0-1 7 4 4 0 0 0 7 5V5Zm0 0a4 4 0 0 1 7 2 4 4 0 0 1 1 7 4 4 0 0 1-7 5V5Z"/><path d="M8 10c3 0 4 2 4 4m4-4c-3 0-4 2-4 4"/></>,history:<><path d="M3 12a9 9 0 1 0 3-7M3 3v5h5"/><path d="M12 7v5l4 3"/></>,star:<path d="m12 2 3.1 6.5 7.1 1-5.1 5 .9 7.2L12 18.4l-6 3.3.9-7.2-5.1-5 7.1-1L12 2Z"/>,play:<><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/></>,left:<path d="M20 12H4m7-7-7 7 7 7"/>,plus:<path d="M12 4v16M4 12h16"/>,sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2m20 0h-2M5 5l1.5 1.5M17.5 17.5 19 19m0-14-1.5 1.5M6.5 17.5 5 19"/></>,fire:<path d="M12 22c-4 0-7-3-7-7 0-4 3-6 5-10 0 5 4 4 4 9 2-2 3-4 3-6 4 6 4 10 2 12a9 9 0 0 1-7 2Z"/>,leaf:<path d="M20 3C9 3 4 9 4 16c0 3 2 5 5 5 7 0 12-6 11-18ZM4 21c3-6 7-9 12-12"/>,shield:<><path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-4Z"/><path d="m8 12 3 3 5-6"/></>,reset:<><path d="M4 12a8 8 0 1 0 3-6M4 4v5h5"/></>,message:<path d="M4 4h16v12H9l-5 4V4Z"/>,grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>};
export function Icon({name,size=20,className=''}:{name:IconName;size?:number;className?:string}){return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>}
export function Brand({compact=false}:{compact?:boolean}){return <Link href="/" className="brand" aria-label="DineTuned Home"><span className="brand-icon"><Icon name="fork" size={17}/></span><span>{compact?'DineTuned':<>dine<span className="brand-accent">tuned</span><span className="brand-dot">.</span></>}</span></Link>}

const nav = [
  { href: '/discover', label: 'Explore', icon: 'compass' as IconName },
  { href: '/taste', label: 'My taste', icon: 'heart' as IconName },
  { href: '/picks', label: 'My picks', icon: 'spark' as IconName },
  { href: '/memory', label: 'Memories', icon: 'history' as IconName },
];

export function Shell({ children, demoMode = false }: { children: ReactNode; demoMode?: boolean }) {
  const path = usePathname();
  const { taste, storageWarning, selection } = useDineTuned();
  const identity = useIdentity().state;
  const realSelected = identity.status === 'ready' && !!identity.table.getSelection();
  // /picks owns its loading and empty states. Redirecting here races the
  // authenticated table restore on a new tab or full reload.
  const href = (destination: string) => destination;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner"><Brand/>
      <nav className="desktop-nav" aria-label="Main navigation">{nav.map(item =>
        <Link key={item.href} href={href(item.href)} className={'nav-link '+(path.startsWith(item.href) ? 'active' : '')}
          aria-current={path.startsWith(item.href) ? 'page' : undefined}>{item.label}</Link>)}</nav>
      <div className="header-actions"><Link href="/how-it-works" className="header-guide"><Icon name="info" size={16}/> How it works</Link>
        <Link className="profile-avatar" aria-label={taste.complete ? 'Your taste profile' : 'Start Taste Detective'} href={taste.complete ? '/taste' : '/onboarding'}><Icon name="user" size={19}/></Link></div>
    </div></header>
    <div className="demo-banner"><span className="status-dot"/><span>{demoMode ? 'Fictional offline demo' : 'DineTuned preview'}</span><span className="demo-mid">{demoMode ? '· Your demo palate and memories stay separate from your guest account' : realSelected ? '· Your selected restaurant · AI only when approved' : selection ? '· Fictional demo menu · Demo Picks' : '· Real search when approved · Separate fictional demo available'}</span>{demoMode ? <><button type="button" onClick={restartDemo}>Restart demo</button><button type="button" onClick={leaveDemoExplore}>Exit demo · Real restaurants <Icon name="arrow" size={13}/></button></> : <Link href="/how-it-works">What powers this <Icon name="arrow" size={13}/></Link>}</div>
    {storageWarning && <div className="storage-warning" role="status">Browser storage is unavailable. You can keep exploring, but new changes may not survive a refresh.</div>}
    <div id="main-content" tabIndex={-1}>{children}</div>
    <footer className="site-footer"><div><Brand/><p>Fine-tuned to your taste.</p></div><div className="footer-right"><Link href="/how-it-works">How DineTuned works</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><span>© 2026 DineTuned · Development preview</span></div></footer>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(item =>
      <Link key={item.href} href={href(item.href)} className={path.startsWith(item.href) ? 'current' : ''} aria-current={path.startsWith(item.href) ? 'page' : undefined}>
        <Icon name={item.icon} size={21}/><span>{item.label}</span></Link>)}</nav>
  </div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow"><span className="eyebrow-line"/>{children}</span>;
}
export function ButtonLink({ href, children, variant = 'primary', className = '' }: {
  href: string; children: ReactNode; variant?: 'primary' | 'outline' | 'white'; className?: string;
}) {
  return <Link className={`button button-${variant} ${className}`} href={href}>{children}</Link>;
}
