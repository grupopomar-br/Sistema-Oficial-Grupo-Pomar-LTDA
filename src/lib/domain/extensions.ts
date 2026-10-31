import { z } from "zod";
import { isSafeCheckoutUrl } from "../billing/safety.ts";
import { isDateOnly } from "./dates.ts";
const id = z.uuid(),
  timestamp = z.iso.datetime({ offset: true });
const date = z.string().refine(isDateOnly, "Data inválida.");
const cents = z.number().int().min(0).max(100_000_000_000);
const base = {
  id,
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const ideaSchema = z.strictObject({
  ...base,
  title: z.string().trim().min(2).max(160),
  detail: z.string().trim().max(10000),
  category: z.enum([
    "general",
    "operations",
    "billing",
    "security",
    "automation",
    "product",
  ]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  stage: z.enum(["inbox", "planned", "doing", "done", "archived"]),
  taskId: id.nullable(),
});
export const collectionAgreementSchema = z
  .strictObject({
    ...base,
    contractId: id,
    initialCents: cents,
    gate: z.enum(["none", "initial", "full"]),
    graceDays: z.number().int().min(0).max(30),
    acceptedOn: date.nullable(),
    termsReference: z.string().trim().max(500),
    notes: z.string().trim().max(5000),
  })
  .refine(
    (v) => !v.acceptedOn || v.termsReference.length >= 3,
    "Informe a referência do aceite ou contrato.",
  )
  .refine(
    (v) => v.gate !== "initial" || v.initialCents > 0,
    "Informe o valor da entrada combinada.",
  );
export const collectionActionSchema = z
  .strictObject({
    ...base,
    installmentId: id,
    kind: z.enum(["contact", "reminder", "promise", "dispute"]),
    channel: z.enum(["manual", "email", "whatsapp", "phone"]),
    note: z.string().trim().min(3).max(2000),
    promiseOn: date.nullable(),
  })
  .refine(
    (v) => v.kind !== "promise" || !!v.promiseOn,
    "Informe a data prometida para o pagamento.",
  );
export const chargeSchema = z.strictObject({
  ...base,
  installmentId: id,
  provider: z.literal("mercadopago"),
  status: z.enum(["creating", "ready", "creation_unknown", "failed"]),
  mode: z.enum(["test", "live"]),
  amountCents: cents.positive(),
  expiresAt: timestamp,
  checkoutUrl: z
    .string()
    .max(2048)
    .refine(
      (v) => v === "" || isSafeCheckoutUrl(v),
      "URL do checkout inválida.",
    ),
  preferenceId: z.string().max(200).nullable(),
});
export const providerPaymentSchema = z.strictObject({
  ...base,
  provider: z.literal("mercadopago"),
  providerPaymentId: z.string().regex(/^\d{1,30}$/),
  chargeId: id.nullable(),
  receiptId: id.nullable(),
  amountCents: cents.positive(),
  feeCents: cents.nullable(),
  refundedCents: cents,
  currency: z.literal("BRL"),
  status: z.enum([
    "pending",
    "in_process",
    "authorized",
    "approved",
    "rejected",
    "cancelled",
    "in_mediation",
    "refunded",
    "charged_back",
    "unknown",
  ]),
  mode: z.enum(["test", "live"]),
  paidOn: date.nullable(),
  providerUpdatedAt: timestamp,
  reviewReason: z.string().max(300),
});
export const refundSchema = z.strictObject({
  ...base,
  receiptId: id,
  installmentId: id,
  providerPaymentId: id,
  providerRefundId: z.string().regex(/^\d{1,40}$/),
  amountCents: cents.positive(),
  occurredOn: date,
  reason: z.enum(["refund"]),
});
export const extensionCommands = [
  z.strictObject({ type: z.literal("saveIdea"), value: ideaSchema }),
  z.strictObject({
    type: z.literal("convertIdeaToTask"),
    id,
    taskId: id,
    projectId: id.nullable(),
  }),
  z.strictObject({
    type: z.literal("saveCollectionAgreement"),
    value: collectionAgreementSchema,
  }),
  z.strictObject({
    type: z.literal("addCollectionAction"),
    value: collectionActionSchema,
  }),
] as const;
export type Idea = z.infer<typeof ideaSchema>;
export type CollectionAgreement = z.infer<typeof collectionAgreementSchema>;
export type CollectionAction = z.infer<typeof collectionActionSchema>;
export type Charge = z.infer<typeof chargeSchema>;
export type ProviderPayment = z.infer<typeof providerPaymentSchema>;
export type Refund = z.infer<typeof refundSchema>;
