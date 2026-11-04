import Link from 'next/link';
import { Icon } from './UI';

export function LoadingState({ label = 'Opening the menu…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="loading-orbit"/><p>{label}</p></div>;
}
export function ErrorState({ error, retry, back = '/discover' }: { error: Error; retry?: () => void; back?: string }) {
  return <div className="error-state" role="alert"><Icon name="book" size={30}/><h2>A little pause at the table.</h2>
    <p>{error.message}</p><div className="inline-actions">{retry && <button className="button button-primary" onClick={retry}>Try again</button>}
      <Link className="button button-outline" href={back}>Back to restaurants</Link></div></div>;
}
