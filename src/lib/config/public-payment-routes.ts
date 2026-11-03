// These routes already use the private charge token or contain no account data.
// Owner pages and APIs must still refresh/validate their own authenticated session.
export function isPublicPaymentRoute(pathname: string): boolean {
  return (
    pathname === "/pagamento/visualizar" ||
    pathname === "/pagamento/retorno" ||
    /^\/(?:pagar|api\/checkout)\/[A-Za-z0-9_-]{43}$/.test(pathname)
  );
}
