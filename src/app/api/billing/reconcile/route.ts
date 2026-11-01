import { z } from "zod";
import { parseEnvironment } from "@/lib/config/environment";
import { parseBillingConfig } from "@/lib/config/billing";
import {
  sensitiveOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import { ProviderError } from "@/lib/billing/mercadopago";
import {
  fetchVerifiedTransaction,
  providerIdPattern,
  orderIdPattern,
  fetchOrderForCharge,
} from "@/lib/billing/orders";
import { pixWorkerReady } from "@/lib/server/pix-checkout";
import { providerErrorDetails } from "@/lib/billing/provider-diagnostics";
import { todayDate } from "@/lib/domain/dates";
import {
  applyVerifiedPayment,
  billingWorkerReady,
} from "@/lib/server/billing-worker";
import { boundedJson, json, errorResponse } from "@/lib/server/http";
import { readWorkspace, databaseFailure } from "@/lib/server/workspace";
export async function POST(request: Request) {
  try {
    const app = parseEnvironment(process.env);
    requireOrigin(request, app.appUrl);
    const owner = await sensitiveOwner(false);
    const config = parseBillingConfig(process.env);
    if (!config.enabled)
      throw new AccessError(
        "A integração de cobrança ainda não foi ativada.",
        503,
      );
    const input = z
      .strictObject({
        paymentId: z.string().regex(providerIdPattern),
        chargeId: z.uuid().optional(),
        confirmedPaidOn: z.iso
          .date()
          .refine((d) => d <= todayDate())
          .optional(),
      })
      .parse(await boundedJson(request, 8192));
    if (input.chargeId) {
      if (input.confirmedPaidOn || !orderIdPattern.test(input.paymentId))
        throw new AccessError(
          "Confira a order antes de informar uma data.",
          400,
        );
      const { data: charge, error: chargeError } = await owner.supabase
        .from("pomar_charges")
        .select("id,amount_cents")
        .eq("id", input.chargeId)
        .eq("owner_id", owner.user.id)
        .eq("mode", config.mode)
        .eq("status", "ready")
        .maybeSingle();
      if (chargeError) throw databaseFailure(chargeError);
      if (!charge)
        throw new AccessError("Cobrança não localizada nesta operação.", 404);
      if (
        !(await billingWorkerReady(config, owner.user.id)) ||
        !(await pixWorkerReady(config))
      )
        throw new AccessError(
          "A configuração do checkout precisa ser atualizada.",
          503,
        );
      const result = await fetchOrderForCharge(config, input.paymentId, {
        id: charge.id,
        amountCents: Number(charge.amount_cents),
      });
      await applyVerifiedPayment(config, result.payment);
      return json({ workspace: await readWorkspace(owner.supabase) });
    }
    const { data, error } = await owner.supabase
      .from("pomar_provider_payments")
      .select("id")
      .eq("provider_payment_id", input.paymentId)
      .eq("mode", config.mode)
      .maybeSingle();
    if (error) throw databaseFailure(error);
    if (!data)
      throw new AccessError("Pagamento não localizado nesta operação.", 404);
    if (!(await billingWorkerReady(config, owner.user.id)))
      throw new AccessError(
        "A configuração do processador precisa ser conferida.",
        503,
      );
    const payment = await fetchVerifiedTransaction(config, input.paymentId);
    if (input.confirmedPaidOn) {
      if (
        !orderIdPattern.test(input.paymentId) ||
        payment.status !== "approved" ||
        payment.refundedCents !== 0
      )
        throw new AccessError(
          "Confira o estado atual do pagamento antes de informar a data.",
          409,
        );
      if (payment.paidOn && payment.paidOn !== input.confirmedPaidOn)
        throw new AccessError(
          "A data informada diverge da data confirmada pelo provedor.",
          409,
        );
      payment.paidOn = input.confirmedPaidOn;
    }
    await applyVerifiedPayment(
      config,
      input.confirmedPaidOn
        ? { ...payment, ownerConfirmedBy: owner.user.id }
        : payment,
    );
    return json({ workspace: await readWorkspace(owner.supabase) });
  } catch (error) {
    if (error instanceof ProviderError) {
      const details = providerErrorDetails(error);
      console.error(
        JSON.stringify({
          event: "billing_reconciliation_failed",
          stage: "provider",
          ...details,
        }),
      );
      return json(
        {
          error:
            "O provedor não confirmou a consulta. Tente novamente depois de conferir o ambiente.",
          ...details,
        },
        503,
      );
    }
    return errorResponse(error);
  }
}
