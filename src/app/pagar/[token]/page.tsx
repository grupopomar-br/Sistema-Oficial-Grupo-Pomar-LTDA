import type { Metadata } from "next";
import { Suspense } from "react";
import PaymentCheckout from "@/components/payment-checkout";
import PaymentCheckoutLoading from "@/components/payment-checkout-loading";
import { readPixCheckout } from "@/lib/server/pix-checkout";
import { checkoutTokenPattern } from "@/lib/billing/pix-contract";
export const metadata: Metadata = {
  title: "Pagamento | Grupo Pomar",
  description: "Confira e conclua seu pagamento ao Grupo Pomar.",
  robots: { index: false, follow: false },
};
async function CheckoutContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let loadFailed = false;
  const initial = checkoutTokenPattern.test(token)
    ? await readPixCheckout(token).catch(() => {
        loadFailed = true;
        return null;
      })
    : null;
  return (
    <PaymentCheckout
      initial={initial}
      loadFailed={loadFailed}
      token={checkoutTokenPattern.test(token) ? token : undefined}
    />
  );
}
export default function Page(props: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<PaymentCheckoutLoading />}>
      <CheckoutContent {...props} />
    </Suspense>
  );
}
