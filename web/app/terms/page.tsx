import Link from 'next/link';
export default function Terms() {
  return <main className="places-policy page-padding content-width"><h1>Using DineTuned</h1>
    <p>DineTuned is a development preview of a personal food concierge. Fictional restaurants and sample menus are clearly labeled. Google Places identifies real locations, and a separate website check discovers candidate menu sources. Sources do not establish verified dishes, prices, freshness or allergy information.</p>
    <p>When using Google-powered restaurant discovery, the <a href="https://www.google.com/intl/en/help/terms_maps/">Google Maps / Google Earth Additional Terms of Service</a> are incorporated into these terms and apply to that experience. See also the <a href="https://policies.google.com/terms">Google Terms of Service</a> and <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>
    <p>Confirm addresses, business status, prices and dietary or allergy needs directly with the restaurant. A location result is not a reservation, order, guarantee of availability or confirmation of food safety.</p>
    <p>Do not scrape, bulk download, redistribute or permanently cache Google Places content through this application. Search may be limited or unavailable to protect development costs.</p>
    <p><Link href="/privacy">How your data is handled</Link> · <Link href="/discover">Return to restaurant search</Link></p>
  </main>;
}
