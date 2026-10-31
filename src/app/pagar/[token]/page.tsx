import type { Metadata } from "next";
import PaymentCheckout from "@/components/payment-checkout";
import { readPixCheckout } from "@/lib/server/pix-checkout";
import { checkoutTokenPattern } from "@/lib/billing/pix-contract";
export const metadata: Metadata = {
  title: "Pagamento Pix | Grupo Pomar",
  description: "Confira e conclua seu pagamento ao Grupo Pomar.",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const initial = checkoutTokenPattern.test(token)
    ? await readPixCheckout(token).catch(() => null)
    : null;
  return (
    <PaymentCheckout
      initial={initial}
      token={checkoutTokenPattern.test(token) ? token : undefined}
    />
  );
}
