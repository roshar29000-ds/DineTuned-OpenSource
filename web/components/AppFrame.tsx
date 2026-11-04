'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AppProvider } from './AppProvider';
import { IdentityProvider } from './IdentityProvider';
import { DiningMemoryProvider } from './memory/DiningMemoryProvider';
import { Shell } from './UI';
import { DEMO_SESSION_KEY } from '../lib/demo-session';

export function AppFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  useEffect(() => { setDemoMode(sessionStorage.getItem(DEMO_SESSION_KEY) === '1'); }, [path]);
  // Local fixture previews are intentionally outside guest identity and storage.
  if (path === '/picks-preview' || path === '/culinary-orbit-preview') return <div id="main-content">{children}</div>;
  if (path === '/demo') return <AppProvider sessionOnly><div id="main-content">{children}</div></AppProvider>;
  if (demoMode === null) return <div className="app-loading" role="status">Setting your table…</div>;
  if (demoMode) return <AppProvider sessionOnly><IdentityProvider localOnly><DiningMemoryProvider sessionOnly><Shell demoMode>{children}</Shell></DiningMemoryProvider></IdentityProvider></AppProvider>;
  return <AppProvider><IdentityProvider><DiningMemoryProvider><Shell>{children}</Shell></DiningMemoryProvider></IdentityProvider></AppProvider>;
}
