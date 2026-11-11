import {
  checkoutTokenPattern,
  parseCheckoutPath,
} from "../billing/checkout-link.ts";

// These routes already use the private charge token or contain no account data.
// Owner pages and APIs must still refresh/validate their own authenticated session.
export function isPublicPaymentRoute(pathname: string): boolean {
  return (
    pathname === "/pagamento/visualizar" ||
    pathname === "/pagamento/retorno" ||
    (pathname.startsWith("/pagar/") &&
      parseCheckoutPath(pathname.slice("/pagar/".length).split("/")) !==
        null) ||
    (pathname.startsWith("/api/checkout/") &&
      checkoutTokenPattern.test(pathname.slice("/api/checkout/".length)))
  );
}
