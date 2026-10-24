import { MerchantView } from '@/components/merchant';

export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MerchantView id={id} />;
}
