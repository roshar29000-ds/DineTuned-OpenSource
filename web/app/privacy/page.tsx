import Link from 'next/link';
export default function Privacy() {
  return <main className="places-policy page-padding content-width"><h1>Privacy at DineTuned</h1>
    <p>DineTuned is a development preview. Your Taste DNA and local dining records are stored in your browser. When cloud storage is configured, Supabase provides a guest identity and private storage for explicitly saved Taste DNA and dining history.</p>
    <h2>Restaurant search</h2><p>When enabled, real restaurant search sends your search text, optional city or area, and optional device location to Google Places through our server. Location is requested only when you choose “Use my location.” Your Taste DNA and dining history are not sent to Google.</p>
    <p>Google restaurant details are held in memory for the current visit, not saved to your dining history or browser storage. Our server stores temporary search sessions, place IDs and request counters to limit usage. It does not store your search text or location in this limiter.</p>
    <h2>Menu source checks</h2><p>When you submit a restaurant website, our server checks a bounded number of public pages and menu links. The website receives our crawler's requests and server IP address, not your Taste DNA, Supabase token or personal dining history. Source evidence stays in memory for the current visit. Local request counters contain hashed guest identities and job IDs, not website content.</p>
    <p>Google’s handling of information is described in the <a href="https://policies.google.com/privacy" rel="noreferrer">Google Privacy Policy</a>, incorporated here for the Google services used in this experience.</p>
    <h2>Your controls</h2><p>You can search without location access, choose the fictional demo, correct or delete dining records in Memory, and explicitly restore a Taste DNA backup. Clearing browser storage can remove access to an anonymous guest account; keep your session if you want to return to cloud records.</p>
    <p>This milestone does not send your searches or profile to Meta AI. <Link href="/terms">Read the terms</Link> or <Link href="/discover">return to restaurant search</Link>.</p>
  </main>;
}
