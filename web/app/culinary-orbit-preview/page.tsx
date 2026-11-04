import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { OrbitPreview } from './preview';

export const dynamic = 'force-dynamic';

const seconds = (value?: string) => { const parsed = Number(value); return value && Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };

/** Local review only: needs the preview flag and a loopback host. Makes no API or provider requests. */
export default async function CulinaryOrbitPreviewPage({ searchParams }: { searchParams: Promise<{ capture?: string; film?: string; ready?: string; error?: string }> }) {
  const host = (await headers()).get('host') || '';
  if (process.env.DINETUNED_TEST_KITCHEN_PREVIEW !== 'true' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) notFound();
  const params = await searchParams;
  return <OrbitPreview capture={params.capture === '1'} film={params.film === '1'} readyAt={seconds(params.ready)} errorAt={seconds(params.error)}/>;
}
