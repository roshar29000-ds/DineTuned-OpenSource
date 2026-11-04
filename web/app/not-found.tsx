import Link from 'next/link';
export default function NotFound() {
  return <main className="content-width page-padding"><div className="empty-wide"><h1>A table we couldn’t find.</h1><p>This page does not exist. Find your restaurant to continue.</p><Link className="button button-primary" href="/discover">Find a restaurant</Link></div></main>;
}
