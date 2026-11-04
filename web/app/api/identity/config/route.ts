import { NextResponse } from 'next/server';
import { cloudConfiguration } from '../../../../lib/identity/config';

export const dynamic = 'force-dynamic';
export function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return NextResponse.json(cloudConfiguration(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY), { headers });
  } catch {
    // Never return a misconfigured key or include it in logs/errors.
    return NextResponse.json({ detail: 'Cloud storage configuration is invalid. Browser data remains local.' }, { status: 503, headers });
  }
}
