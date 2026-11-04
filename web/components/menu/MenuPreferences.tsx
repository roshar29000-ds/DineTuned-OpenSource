'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { DiningConstraints } from '../../lib/contracts';
import { Icon } from '../UI';
import { MenuFilters } from './PreferenceControls';

export function MenuPreferences({ value, onChange, onHardChange, open, onClose, eligibleCount, checksUnavailable }: {
  value: DiningConstraints; onChange: (next: DiningConstraints) => void; onHardChange: (next: DiningConstraints) => void;
  open: boolean; onClose: () => void; eligibleCount: number | null; checksUnavailable: boolean;
}) {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const change = () => { setMobile(query.matches); onClose(); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!mobile || !open || !element) return;
    const priorOverflow = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = priorOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [mobile, open]);
  const filters = <MenuFilters value={value} onChange={onChange} onHardChange={onHardChange}/>;
  if (!mobile) return <aside className="menu-filter-aside" id="menu-preferences" aria-label="Budget and preferences">
    <div className="menu-preferences-desktop">{filters}<div className="menu-preferences-foot"><Icon name="heart" size={16}/><span>Your Taste DNA guides your picks.<Link href="/taste">Fine-tune my taste <Icon name="arrow" size={13}/></Link></span></div></div>
  </aside>;
  return <dialog ref={dialog} className="menu-preferences-sheet" aria-labelledby="menu-preferences-title" onCancel={onClose}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
        .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="menu-sheet-header"><div><span className="section-kicker">MAKE IT YOURS</span><h2 id="menu-preferences-title">Budget & preferences</h2></div>
      <button autoFocus className="icon-button" aria-label="Close preferences" onClick={onClose}><Icon name="close" size={22}/></button></header>
    <div className="menu-sheet-body">{filters}</div>
    <footer className="menu-sheet-footer"><span role="status">{checksUnavailable ? 'Checks unavailable · preferences saved' : eligibleCount === null ? 'Checking your preferences…' : `${eligibleCount} eligible ${eligibleCount === 1 ? 'dish' : 'dishes'} · changes saved`}</span>
      <button className="button button-primary" onClick={onClose}>Back to menu <Icon name="arrow" size={17}/></button></footer>
  </dialog>;
}
