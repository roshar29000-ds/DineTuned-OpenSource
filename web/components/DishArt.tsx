'use client';
import { useId } from 'react';
import type { MediaAsset } from '../lib/contracts';

type Props = { name: string; media?: MediaAsset; seed?: string; className?: string; caption?: boolean };
// Exact fictional dish matches only. These original generated studies are not
// restaurant photography and must never stand in for a different menu item.
const demoPhotos: Record<string, string> = {
  'crispy mushroom bánh mì': '/demo-food/crispy-mushroom-banh-mi.jpg',
  'roasted cauliflower tacos': '/demo-food/roasted-cauliflower-tacos.jpg',
  'crispy mushroom tacos': '/demo-food/crispy-mushroom-tacos.jpg',
  'baja fish tacos': '/demo-food/baja-fish-tacos.jpg',
  'lemon calamari': '/demo-food/lemon-calamari.jpg',
  'lemon tart': '/picks-preview/lemon-tart.jpg',
  'chicken karaage': '/demo-food/chicken-karaage.jpg',
  'onion bhaji': '/demo-food/onion-bhaji.jpg',
  'chickpea fritters': '/demo-food/chickpea-fritters.jpg',
};
/** Local demo illustrations or honest placeholders; never restaurant photography. */
export function DishArt({ name, media, seed = name, className = '', caption = true }: Props) {
  const photo = demoPhotos[name.trim().toLowerCase()];
  if (photo) return <div className={`dish-art dish-art-photo ${className}`}>
    <img src={photo} alt={`AI-generated illustration of fictional dish ${name}; not restaurant photography`} loading="eager"/>
    {caption && <span className="art-caption">AI-generated illustration · fictional dish</span>}
  </div>;
  const uid = useId().replace(/:/g, '');
  const hash = [...seed].reduce((n, c) => n + c.charCodeAt(0), 0);
  const motif = media?.motif || 'bowl';
  const accent = media?.accent || '#dce6d6';
  const angle = (hash % 30) - 15;
  const green = '#476b3e', orange = '#cf713e', cream = '#f0d7a1', dark = '#8b5135';
  const garnish = Array.from({ length: 9 }, (_, i) => {
    const a = (i * 137 + hash) * Math.PI / 180, radius = 24 + (i * 13 % 55);
    return <ellipse key={i} cx={240 + Math.cos(a) * radius} cy={166 + Math.sin(a) * radius * .63}
      rx={9} ry={3.5} transform={`rotate(${i * 41} ${240 + Math.cos(a) * radius} ${166 + Math.sin(a) * radius * .63})`} fill={green} opacity=".9" />;
  });
  const food = () => {
    if (motif === 'noodles' || motif === 'curry' || motif === 'bowl') return <>
      <ellipse cx="240" cy="165" rx="93" ry="66" fill={motif === 'curry' ? '#c77742' : '#b4935a'} />
      <ellipse cx="240" cy="165" rx="85" ry="58" fill={motif === 'curry' ? '#d99558' : '#dec286'} />
      {motif === 'noodles' ? Array.from({ length: 7 }, (_, i) => <path key={i} d={`M ${188+i*6} 132 C 145 180 280 118 279 169 S 181 223 210 ${150+i*5}`} stroke={cream} strokeWidth="5" fill="none" strokeLinecap="round" />)
        : Array.from({ length: 7 }, (_, i) => <rect key={i} x={184+(i%3)*35} y={128+Math.floor(i/3)*27} width="26" height="22" rx="7" fill={i%2 ? '#bc6335' : '#e2ae6d'} transform={`rotate(${i*11} 240 165)`} />)}
      {garnish}<path d="M285 175a21 21 0 0 0-28 24Z" fill="#8daa61" stroke="#e4e8a9" strokeWidth="4" />
    </>;
    if (motif === 'tacos' || motif === 'toast' || motif === 'rolls' || motif === 'dumplings') return <>
      {[0,1,2].map(i => <g key={i} transform={`translate(${i*43-43} ${i%2*12-6}) rotate(-22 240 165)`}>
        {motif === 'tacos' ? <path d="M211 190Q199 115 239 115Q276 118 270 190Z" fill="#e7bc72" stroke="#b78b43" strokeWidth="2" />
          : <rect x="216" y="120" width="44" height="91" rx={motif === 'dumplings' ? 22 : 13} fill={motif === 'rolls' ? '#dfe4c1' : '#ddb77b'} stroke="#c8a471" strokeWidth="2" />}
        <path d="M234 131Q219 154 235 185M247 138Q235 161 248 190" stroke={green} strokeWidth="7" strokeLinecap="round" />
        <path d="M242 128L234 146M248 163L238 178" stroke={orange} strokeWidth="8" strokeLinecap="round" />
      </g>)}
    </>;
    if (motif === 'pasta') return <>
      {Array.from({length: 18}, (_, i) => <rect key={i} x={176+(i%5)*25} y={122+Math.floor(i/5)*24} width="27" height="14" rx={seed.includes('gnocchi') ? 7 : 3}
        fill={seed.includes('pesto') ? '#a7b674' : i%3 ? '#d68b51' : '#e3ac70'} stroke="#bb7442" strokeWidth="1.5" transform={`rotate(${(i*23)%70-35} ${190+(i%5)*25} ${129+Math.floor(i/5)*24})`} />)}
      {garnish}
    </>;
    if (motif === 'skewers' || motif === 'corn') return <>
      {[0,1,2].map(i => <g key={i} transform={`translate(${i*34-34} 0) rotate(24 240 165)`}>
        <path d="M240 106V228" stroke="#a57d4e" strokeWidth="3" />
        {[0,1,2,3].map(j => <rect key={j} x="228" y={118+j*22} width="25" height="20" rx="5" fill={motif === 'corn' ? '#e1b450' : j%2 ? orange : '#ddba7a'} stroke="#b48a47" />)}
      </g>)}
      {garnish}
    </>;
    return <>
      {Array.from({length: 22}, (_, i) => <ellipse key={i} cx={187+(i*23%110)} cy={124+(i*17%77)} rx={motif === 'salad' ? 20 : 14} ry={motif === 'salad' ? 9 : 5}
        transform={`rotate(${i*31} ${187+(i*23%110)} ${124+(i*17%77)})`}
        fill={motif === 'salad' ? i%3 ? '#79915b' : '#d78857' : '#e4ce9d'} />)}
      {motif === 'plate' && <path d="M213 126Q245 110 278 143L271 181Q238 193 206 173Z" fill={seed.includes('salmon') ? '#d88d69' : '#bd8655'} stroke="#a66c47" strokeWidth="2" />}
      {garnish}
    </>;
  };
  return <div className={`dish-art ${className}`} style={{ backgroundColor: accent }}>
    <svg viewBox="0 0 480 320" role="img" aria-label={`Illustrated placeholder for ${name}; not a photograph of the dish`}>
      <defs>
        <radialGradient id={uid+'bg'}><stop stopColor="#ffffff" stopOpacity=".6"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></radialGradient>
        <radialGradient id={uid+'plate'}><stop stopColor="#fffef7"/><stop offset=".82" stopColor="#f7f3e7"/><stop offset="1" stopColor="#e8e2d3"/></radialGradient>
      </defs>
      <rect width="480" height="320" fill={`url(#${uid}bg)`}/>
      <path d="M28 0V320M42 0V320M438 0V320M452 0V320" stroke="#ffffff" opacity=".25" strokeWidth="2"/>
      <ellipse cx="247" cy="185" rx="123" ry="86" fill="#283f2e" opacity=".09"/>
      <g transform={`rotate(${angle} 240 165)`}>
        <ellipse cx="240" cy="165" rx="122" ry="91" fill={`url(#${uid}plate)`}/>
        <ellipse cx="240" cy="165" rx="107" ry="78" fill="none" stroke="#d8d3c3" strokeWidth="1"/>
        {food()}
      </g>
      <g transform="rotate(20 380 160)" stroke={dark} strokeWidth="5" strokeLinecap="round"><path d="M372 71V253"/><path d="M386 71L379 253"/></g>
      <path d="M75 228Q94 216 88 195Q65 206 75 228Z" fill={green} opacity=".65"/>
      <path d="M81 240Q101 230 104 210Q81 211 81 240Z" fill={green} opacity=".45"/>
      <circle cx="108" cy="79" r="3" fill={dark} opacity=".4"/><circle cx="117" cy="86" r="2" fill={dark} opacity=".3"/>
    </svg>
    {caption && <span className="art-caption">Illustrated placeholder</span>}
  </div>;
}
