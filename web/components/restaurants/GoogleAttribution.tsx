import type { PlaceAttribution } from '../../lib/contracts';

export function GoogleAttribution({ providers = [] }: { providers?: PlaceAttribution[] }) {
  return <span className="places-attribution"><img src="/brand/google-maps.svg" alt="Google Maps" width="98" height="18"/>
    {providers.map((p, index) => <span key={index}>{p.uri && /^https:\/\//i.test(p.uri)
      ? <a href={p.uri} target="_blank" rel="noreferrer noopener">{p.provider}</a> : p.provider}</span>)}
  </span>;
}
