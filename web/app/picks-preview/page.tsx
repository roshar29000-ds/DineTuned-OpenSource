import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PicksPreview } from './preview';

export const dynamic = 'force-dynamic';
export default async function PicksPreviewPage() {
  const host = (await headers()).get('host') || '';
  if (process.env.DINETUNED_TEST_KITCHEN_PREVIEW !== 'true' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) notFound();
  return <PicksPreview/>;
}
