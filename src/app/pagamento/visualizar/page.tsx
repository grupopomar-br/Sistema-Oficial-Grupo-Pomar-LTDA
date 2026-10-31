import type { Metadata } from "next";
import PaymentCheckout from "@/components/payment-checkout";
export const metadata: Metadata = {
  title: "Prévia do checkout | Grupo Pomar",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <PaymentCheckout
      preview
      initial={{
        status: "ready",
        amountCents: 19900,
        description: "Serviços Grupo Pomar",
        reference: "EXEMPLO",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        isTest: true,
        qrCode: null,
        qrBase64: null,
      }}
    />
  );
}
