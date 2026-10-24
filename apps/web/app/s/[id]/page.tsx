import { Suspense } from 'react';
import { BuyerView } from '@/components/buyer';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><BuyerView id={id} /></Suspense>;
}
