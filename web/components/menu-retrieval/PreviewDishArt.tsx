'use client';

/** Local, generated studies of the fictional fixture dishes. Never restaurant photography. */
const previewPhotos: Record<string, string> = {
  'mushroom rice': '/picks-preview/mushroom-rice.jpg',
  'roasted tomato soup': '/picks-preview/roasted-tomato-soup.jpg',
  'garden leaves': '/picks-preview/garden-leaves.jpg',
  'charred chicken': '/picks-preview/charred-chicken.jpg',
  'lemon tart': '/picks-preview/lemon-tart.jpg',
};

export function PreviewDishArt({ dishName }: { dishName: string }) {
  const src = previewPhotos[dishName.trim().toLowerCase()];
  return <figure className={'real-pick-media preview-pick-media' + (src ? ' has-image' : '')}>
    {src ? <img src={src} alt={`AI-generated illustration of fictional menu dish ${dishName}; not restaurant photography`} loading="eager"/>
      : <div className="real-pick-media-placeholder" aria-hidden="true"><b>{dishName}</b></div>}
    <figcaption>{src ? 'AI-generated illustration · Fictional dish, not restaurant photography' : 'Sample image unavailable · Fictional menu'}</figcaption>
  </figure>;
}
