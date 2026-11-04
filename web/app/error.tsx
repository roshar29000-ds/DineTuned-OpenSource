'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="content-width page-padding"><div className="error-state" role="alert"><h1>Let’s try that again.</h1><p>Something interrupted this page. Your saved profile is still in this browser.</p>
    <button className="button button-primary" onClick={reset}>Try again</button></div></main>;
}
