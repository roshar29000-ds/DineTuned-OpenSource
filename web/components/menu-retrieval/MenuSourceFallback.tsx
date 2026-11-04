'use client';
import { useEffect, useRef, useState } from 'react';
import { decodeQrFile, inspectLocalFile, safeMenuUrl } from '../../lib/menu-retrieval/local-source';
import { MAX_MENU_UPLOAD_BYTES, uploadMenuDocument } from '../../lib/menu-retrieval/upload';
import type { MenuDiscoveryHandoff, MenuExtractionResult } from '../../lib/contracts';
import { useIdentity } from '../IdentityProvider';
import { RealRestaurantMenu } from './RealRestaurantMenu';
import { signedTokenExpired } from '../../lib/menu-retrieval/real-session';
import { Icon } from '../UI';

type Mode = 'upload' | 'camera' | 'qr';
type Preview = { url: string; name: string; kind: 'image' | 'pdf' | 'html'; size: number };
const methods: { id: Mode; title: string; text: string; icon: 'book' | 'camera' | 'grid' }[] = [
  { id: 'upload', title: 'Upload Menu', text: 'Choose a photo or PDF you already have.', icon: 'book' },
  { id: 'camera', title: 'Scan Menu with Camera', text: 'Capture a page with your phone’s camera.', icon: 'camera' },
  { id: 'qr', title: 'Scan QR Code', text: 'Read a menu link from a QR image, where supported.', icon: 'grid' },
];

export function MenuSourceFallback({ handoff }: { handoff?: MenuDiscoveryHandoff }) {
  const { state } = useIdentity();
  const table = state.status === 'ready' ? state.table : null;
  const [mode, setMode] = useState<Mode | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null), [extraction, setExtraction] = useState<MenuExtractionResult | null>(
    () => handoff ? table?.getExtraction(handoff) || null : null);
  const [linkInput, setLinkInput] = useState(''), [link, setLink] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null), qr = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; uploadController.current?.abort(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  function clear() { generation.current++; uploadController.current?.abort(); uploadController.current = null; table?.clearExtraction();
    setPreview(null); setFile(null); setExtraction(null); setMessage(''); setError(''); setBusy(false); setLink(null); setLinkInput(''); }
  function chooseMode(next: Mode) {
    clear(); setMode(next);
    if (next === 'upload') upload.current?.click();
    if (next === 'camera') camera.current?.click();
    // QR also has a paste-link fallback; don't force a camera/file dialog on entry.
  }
  async function receive(file: File | undefined, selectedMode: Mode) {
    if (!file) return;
    clear(); setMode(selectedMode); setBusy(true);
    const token = generation.current;
    try {
      const inspected = await inspectLocalFile(file, selectedMode !== 'upload');
      if (token !== generation.current) return;
      setFile(file);
      setPreview({ url: URL.createObjectURL(file), name: file.name, kind: inspected.kind, size: file.size });
      if (selectedMode === 'qr') {
        const result = await decodeQrFile(file);
        if (token !== generation.current) return;
        if (result.kind === 'link') { setLink(result.url); setLinkInput(result.url); setMessage('A web address was decoded locally. No menu has been retrieved or extracted.'); }
        else setMessage({ unavailable: 'This browser cannot decode QR images. Paste the menu link below instead.',
          not_found: 'No QR code was detected. Try a clearer image or paste the menu link.', invalid: 'This QR code does not contain a supported web address.',
          multiple: 'More than one QR code was found. Choose a photo containing just the menu code.' }[result.kind]);
      } else setMessage(handoff && selectedMode === 'upload' && inspected.kind !== 'image' && file.size <= MAX_MENU_UPLOAD_BYTES
        ? 'Ready to read this user-supplied file with DineTuned’s text parser. Its official origin and branch association remain unverified.'
        : 'Selected locally. No menu text has been extracted. Your file has not been uploaded.');
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'This file could not be read. Try another file or paste a menu link.');
    } finally { if (token === generation.current) setBusy(false); }
  }
  async function extractFile() {
    if (!handoff || !file || !preview || preview.kind === 'image' || file.size > MAX_MENU_UPLOAD_BYTES
        || state.status !== 'ready' || uploadController.current) return;
    if (!handoff.source_discovery_token || signedTokenExpired(handoff.source_discovery_token, 23 * 3600 * 1000)) {
      setError('This branch selection has expired. Choose the restaurant again before uploading; no file or API request was sent.'); return;
    }
    const abort = new AbortController(); uploadController.current = abort;
    const current = ++generation.current;
    setBusy(true); setError(''); setMessage(''); setExtraction(null);
    try {
      const result = await uploadMenuDocument(handoff, file, crypto.randomUUID(), state.getAccessToken, abort.signal);
      if (!abort.signal.aborted && current === generation.current) { table?.setExtraction(handoff, result); setExtraction(result); }
    } catch (cause) {
      if (!abort.signal.aborted && current === generation.current) setError(cause instanceof Error ? cause.message : 'This file could not be extracted.');
    } finally {
      if (current === generation.current) { setBusy(false); uploadController.current = null; }
    }
  }
  return <section className="mr-fallback" aria-label="Menu source options">
    <div className="mr-fallback-heading"><div><span className="rs-overline">ANOTHER WAY TO THE TABLE</span><h2>Bring the menu <em>with you.</em></h2></div><span className="mr-local-label">{handoff ? 'USER-SUPPLIED · UNVERIFIED' : 'LOCAL PREVIEW ONLY'}</span></div>
    <p>{handoff ? 'Upload a text PDF or HTML menu for local-rule extraction on DineTuned’s backend. The document is not verified as official, current, or specific to this branch. Images and scanned PDFs still need vision reading.'
      : 'Choose a source to preview in this browser. Select a verified real restaurant first to extract a text PDF or HTML file.'}</p>
    <div className="mr-methods">{methods.map(method => <button key={method.id} className={mode === method.id ? 'selected' : ''} aria-pressed={mode === method.id} onClick={() => chooseMode(method.id)}>
      <Icon name={method.icon} size={23}/><strong>{method.title}</strong><span>{method.text}</span><Icon name="arrow" size={16}/></button>)}</div>
    <input ref={upload} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/html,.html,.htm" aria-label="Upload menu file" onChange={event => { void receive(event.target.files?.[0], 'upload'); event.target.value = ''; }}/>
    <input ref={camera} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Capture menu photo" onChange={event => { void receive(event.target.files?.[0], 'camera'); event.target.value = ''; }}/>
    <input ref={qr} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Choose QR image" onChange={event => { void receive(event.target.files?.[0], 'qr'); event.target.value = ''; }}/>
    {mode && <div className="mr-local-workspace">
      <div className="mr-workspace-heading"><strong>{mode === 'qr' ? 'A link to the menu' : 'Your local menu preview'}</strong><button className="text-button" onClick={() => { clear(); setMode(null); }}>Clear and close</button></div>
      {mode === 'camera' && <p>On supported phones, the file chooser offers the camera. On desktop, choose an existing photo. This captures an image; it does not read menu text.</p>}
      {mode === 'upload' && <p>Text PDF or HTML · up to 3 MB for extraction. Images and scanned PDFs can be previewed locally but cannot be read yet.</p>}
      {mode === 'qr' && <><p>QR decoding runs locally when your browser supports it. Nothing is opened or fetched automatically.</p><button className="button button-outline" onClick={() => qr.current?.click()}><Icon name="camera" size={17}/> Choose or photograph a QR code</button></>}
      {preview && <div className="mr-file-preview">{preview.kind === 'image' ? <img src={preview.url} alt="Your selected local menu or QR image; not extracted menu data" onError={() => { setError('The selected image could not be displayed. Try a different JPEG, PNG, or WebP file.'); setPreview(null); }}/>
        : <div className="mr-pdf-mark"><Icon name="book" size={34}/><span>{preview.kind === 'html' ? 'HTML' : 'PDF'}</span><small>File selected · no extraction yet</small></div>}
        <div><strong>{preview.name}</strong><span>{(preview.size / 1024).toFixed(1)} KB · {extraction ? 'read by DineTuned; file not stored' : 'selected in this browser'}</span><span className="mr-local-label">{extraction ? 'USER DOCUMENT · NOT OFFICIAL-VERIFIED' : 'NO EXTRACTION PERFORMED'}</span>
          {preview.kind === 'pdf' && <a className="text-arrow mr-open-pdf" href={preview.url} target="_blank" rel="noopener noreferrer">Open PDF in browser <Icon name="arrow" size={15}/></a>}</div></div>}
      {handoff && mode === 'upload' && preview && <div className="mr-upload-action">
        {preview.kind === 'image' ? <p>Image reading is not connected. No dishes or prices will be inferred from this file.</p>
          : preview.size > MAX_MENU_UPLOAD_BYTES ? <p>This file exceeds the 3 MB extraction limit. It remains a local preview only.</p>
          : <button type="button" className="button button-primary" disabled={busy || state.status !== 'ready'} onClick={() => void extractFile()}>
              <Icon name="book" size={17}/>{busy ? 'Reading uploaded menu…' : 'Extract this menu file'}</button>}
        <p>No Google, website or Meta request is made by file extraction. Confirm availability and allergens with staff.</p>
      </div>}
      {busy && <p role="status">{mode === 'qr' ? 'Checking this image for a QR code…' : 'Checking the selected file…'}</p>}
      {message && <p className="mr-local-message" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {extraction && extraction.menu.total_items === 0 && <p className="source-notice" role="status">No validated dishes were recovered from this file. A scanned PDF or image needs vision extraction, which is not enabled.</p>}
      {mode === 'qr' && <form className="mr-link-form" onSubmit={event => { event.preventDefault(); generation.current++; setBusy(false); const url = safeMenuUrl(linkInput); setLink(url);
        setError(url ? '' : 'Enter a complete http:// or https:// web address without a username or password.'); setMessage(url ? 'Web address recognized. The website and its menu have not been checked.' : ''); }}>
        <label htmlFor="menu-link-input">Or paste the menu’s web address</label><div><input id="menu-link-input" type="text" inputMode="url" maxLength={2048} value={linkInput} placeholder="https://restaurant.example/menu" onChange={event => { generation.current++; setBusy(false); setLinkInput(event.target.value); setLink(null); setError(''); setMessage(''); }}/><button className="button button-primary" type="submit">Check link</button></div>
      </form>}
      {link && <div className="mr-link-result"><span>EXTERNAL LINK · NOT A VERIFIED MENU SOURCE</span><strong>{new URL(link).hostname}</strong><p>{link}</p><a className="text-arrow" href={link} target="_blank" rel="noopener noreferrer">Open link in new tab <Icon name="arrow" size={16}/></a></div>}
    </div>}
    {extraction && extraction.menu.total_items > 0 && <RealRestaurantMenu result={extraction} reviewSources={() => { table?.clearExtraction(); setExtraction(null); }}/>}
  </section>;
}
