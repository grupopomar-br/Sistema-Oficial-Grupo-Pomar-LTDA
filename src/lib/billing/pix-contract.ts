import { z } from "zod";

export const checkoutTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function validTaxId(input: string): boolean {
  const s = input.replace(/[.\-/\s]/g, "");
  if (!/^\d{11}$|^\d{14}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  const values = [...s].map(Number);
  const digit = (length: number) => {
    let weight = s.length === 11 ? length + 1 : length - 7;
    const sum = values.slice(0, length).reduce((total, value) => {
      const next = total + value * weight--;
      if (weight < 2) weight = 9;
      return next;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const size = s.length - 2;
  return digit(size) === values[size] && digit(size + 1) === values[size + 1];
}

export const pixPayerSchema = z.strictObject({
  name: z.string().trim().min(3, "Informe seu nome completo.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Confira seu e-mail.")),
  document: z
    .string()
    .trim()
    .max(24)
    .refine(validTaxId, "Confira o CPF ou CNPJ informado.")
    .transform((s) => s.replace(/[.\-/\s]/g, "")),
});
export type PixPayer = z.infer<typeof pixPayerSchema>;
export type PixCheckout = {
  status: "ready" | "pending" | "paid" | "review" | "expired" | "closed";
  amountCents: number;
  description: string;
  reference: string;
  expiresAt: string;
  isTest: boolean;
  qrCode: string | null;
  qrBase64: string | null;
};
