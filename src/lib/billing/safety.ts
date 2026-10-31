export function isSafeCheckoutUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.port &&
      [
        "www.mercadopago.com.br",
        "sandbox.mercadopago.com.br",
        "www.mercadopago.com",
        "sandbox.mercadopago.com",
      ].includes(u.hostname) &&
      /\/checkout\//.test(u.pathname) &&
      !!u.searchParams.get("pref_id")
    );
  } catch {
    return false;
  }
}
export function decimalCents(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error("Valor monetário inválido.");
  const s = String(value);
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(s))
    throw new Error("Valor monetário inválido.");
  const [whole, fraction = ""] = s.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (amount > 100_000_000_000n) throw new Error("Valor acima do limite.");
  return Number(amount);
}
