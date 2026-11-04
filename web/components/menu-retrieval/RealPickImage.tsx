'use client';
import { useEffect, useState } from 'react';
import { useIdentity } from '../IdentityProvider';

export function RealPickImage({ digest, dishId, dishName, canCheck = true }: { digest: string; dishId: string; dishName: string; canCheck?: boolean }) {
  const identity = useIdentity().state;
  const access = identity.status === 'ready' ? identity.getAccessToken : null;
  const [image, setImage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    setImage(null); setPending(false);
    if (!access) return;
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined, objectUrl: string | undefined;
    const controller = new AbortController();
    async function load(attempt: number) {
      try {
        const token = await access!();
        const response = await fetch(`/api/dinetuned/real-picks/illustrations/${digest}/${dishId}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (closed) return;
        if (response.status === 200 && response.headers.get('content-type')?.includes('image/webp')) {
          const blob = await response.blob();
          if (!closed) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl); setPending(false); }
        } else if (response.status === 202 && attempt < 20) {
          setPending(true); timer = setTimeout(() => void load(attempt + 1), 3000);
        } else setPending(false);
      } catch { if (!closed) setPending(false); }
    }
    void load(0);
    return () => { closed = true; controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [access, digest, dishId, check]);
  return <figure className={'real-pick-media' + (image ? ' has-image' : '')}>
    {image ? <img src={image} alt={`AI-generated illustration inspired by the menu description of ${dishName}; not restaurant photography`} loading="lazy"/>
      : <div className="real-pick-media-placeholder" aria-hidden="true"><b>{dishName}</b></div>}
    <figcaption>{image ? 'Illustrated with Meta Muse Image 1.0 · AI-generated; actual presentation may vary' : pending ? 'Illustration is being prepared · menu image unavailable meanwhile' : 'Menu-inspired illustration unavailable · no restaurant photo claimed'}</figcaption>
    {!image && !pending && access && canCheck && <button className="real-pick-image-check" type="button" onClick={() => setCheck(value => value + 1)}
      aria-label={`Check cached illustration for ${dishName}`}>Check illustration</button>}
  </figure>;
}
