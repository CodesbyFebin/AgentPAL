import { PayLinkCheckout } from "@/components/PayLinkCheckout";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayLinkCheckout linkId={id} />;
}
