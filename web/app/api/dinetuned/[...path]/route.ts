import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };

async function relay(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const route = path.join('/');
  const memoryItem = /^memory\/(events|feedback)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(route);
  const memoryList = ['memory/identity', 'memory/profile', 'memory/events', 'memory/feedback', 'memory/history', 'memory/evidence'].includes(route);
  const memory = memoryList || memoryItem;
  const discovery = ['discovery/sessions', 'discovery/autocomplete', 'discovery/selection'].includes(route);
  const menuSource = route === 'menu-sources/discover';
  const extraction = route === 'menu-extraction/extract';
  const upload = route === 'menu-extraction/upload';
  const realPicks = route === 'real-picks/sessions';
  const guestTable = route === 'real-picks/table' || route === 'real-picks/table/clear';
  const illustration = /^real-picks\/illustrations\/[0-9a-f]{64}\/[a-zA-Z0-9_-]+$/.test(route);
  const privateRoute = memory || discovery || menuSource || extraction || upload || realPicks || illustration || guestTable;
  const allowedGet = memoryList || illustration || route === 'real-picks/table' || route === 'real-picks/config' || route === 'discovery/config' || route === 'restaurants' || route === 'health' || /^restaurants\/[a-zA-Z0-9_-]+\/menu$/.test(route);
  const allowedPost = discovery || menuSource || extraction || upload || realPicks || route === 'real-picks/table/clear' || ['memory/profile', 'memory/events', 'memory/feedback', 'memory/history', 'menu/evaluate', 'taste/profile', 'recommendation-sessions'].includes(route);
  if (!({ GET: allowedGet, POST: allowedPost, PATCH: memoryItem, DELETE: memoryItem }[request.method])) {
    return NextResponse.json({ detail: 'Not found' }, { status: 404 });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (privateRoute) {
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 8192) {
      return NextResponse.json({ detail: 'A signed-in session is required.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const origin = request.headers.get('origin');
    // NextURL rewrites loopback IPs to "localhost". Compare the browser's
    // Origin to the actual HTTP Host, never a caller-supplied forwarded host.
    const requestOrigin = `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`;
    if (request.method !== 'GET' && origin && origin !== requestOrigin) {
      return NextResponse.json({ detail: 'Invalid request origin.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
    headers.Authorization = authorization;
  }
  try {
    const base = (process.env.DINETUNED_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const body = ['POST', 'PATCH'].includes(request.method) ? await request.text() : undefined;
    if (upload && body && new TextEncoder().encode(body).length > 4_200_000) {
      return NextResponse.json({ detail: 'Choose a menu file up to 3 MB.' }, { status: 413 });
    }
    const upstream = await fetch(base + '/api/v2/' + route + request.nextUrl.search, {
      method: request.method,
      headers,
      body,
      cache: 'no-store', signal: AbortSignal.timeout(realPicks || extraction || upload ? 90000 : menuSource ? 45000 : discovery ? 20000 : 12000),
    });
    if (upstream.status >= 500 && !discovery && !menuSource && !extraction && !upload && !realPicks) {
      return NextResponse.json({ detail: 'The dining service is temporarily unavailable. Please try again.' }, { status: 503 });
    }
    return new NextResponse(illustration && upstream.status === 200 ? await upstream.arrayBuffer() : await upstream.text(), {
      status: upstream.status, headers: { 'Content-Type': illustration && upstream.status === 200 ? 'image/webp' : 'application/json', 'Cache-Control': privateRoute ? 'private, no-store' : 'no-store', ...(privateRoute ? { Vary: 'Authorization' } : {}) },
    });
  } catch {
    return NextResponse.json({ detail: 'The dining service is unavailable. Please try again in a moment.' }, { status: 503 });
  }
}
export const GET = relay;
export const POST = relay;
export const PATCH = relay;
export const DELETE = relay;
