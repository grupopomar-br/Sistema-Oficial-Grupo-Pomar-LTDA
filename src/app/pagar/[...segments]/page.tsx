import type { Metadata } from "next";
import { Suspense } from "react";
import PaymentCheckout from "@/components/payment-checkout";
import PaymentCheckoutLoading from "@/components/payment-checkout-loading";
import { readPixCheckout } from "@/lib/server/pix-checkout";
import { parseCheckoutPath } from "@/lib/billing/checkout-link";
export const metadata: Metadata = {
  title: "Pagamento | Grupo Pomar",
  description: "Confira e conclua seu pagamento ao Grupo Pomar.",
  robots: { index: false, follow: false },
};
async function CheckoutContent({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}) {
  const { segments } = await params;
  const checkout = parseCheckoutPath(segments);
  let loadFailed = false;
  const initial = checkout
    ? await readPixCheckout(checkout.token).catch(() => {
        loadFailed = true;
        return null;
      })
    : null;
  return (
    <PaymentCheckout
      initial={initial}
      loadFailed={loadFailed}
      token={checkout?.token}
      clientSlug={checkout?.clientSlug}
    />
  );
}
export default function Page(props: {
  params: Promise<{ segments: string[] }>;
}) {
  return (
    <Suspense fallback={<PaymentCheckoutLoading />}>
      <CheckoutContent {...props} />
    </Suspense>
  );
}
