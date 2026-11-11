import type { BillingConfig } from "../config/billing.ts";
import {
  checkoutPath,
  checkoutSlugPattern,
  checkoutTokenPattern,
} from "./checkout-link.ts";
import { decimalCents, isSafeCheckoutUrl } from "./safety.ts";
import {
  ProviderError,
  providerRequest,
  fetchVerifiedPayment,
  type PreparedCharge,
  type VerifiedPayment,
} from "./mercadopago.ts";
import { verifyOrderAccount } from "./orders.ts";

// Separate rollout: Pix never depends on card settings or card readiness.
export function cardCheckoutEnabled(
  env: Record<string, string | undefined>,
  mode: "live" | "test",
) {
  return (
    env.POMAR_CARD_CHECKOUT_ENABLED === "true" &&
    (mode === "test" || env.POMAR_CARD_LIVE_CONFIRMED === "yes")
  );
}
const failure = () =>
  new ProviderError(
    "As condições do pagamento com cartão não passaram na conferência.",
    true,
  );
export async function createCardPreference(
  config: BillingConfig,
  charge: PreparedCharge & { clientSlug?: string },
  token: string,
  fetcher: typeof fetch = fetch,
) {
  if (
    !checkoutTokenPattern.test(token) ||
    (charge.clientSlug !== undefined &&
      !checkoutSlugPattern.test(charge.clientSlug)) ||
    charge.mode !== config.mode ||
    !Number.isSafeInteger(charge.amountCents) ||
    charge.amountCents <= 0 ||
    charge.amountCents > 100_000_000_000 ||
    Date.parse(charge.expiresAt) <= Date.now() + 300000
  )
    throw failure();
  const [, methods] = await Promise.all([
    verifyOrderAccount(config, fetcher),
    providerRequest(
      config,
      "/v1/payment_methods",
      "GET",
      undefined,
      fetcher,
      undefined,
      5000,
    ),
  ]);
  if (
    !Array.isArray(methods) ||
    methods.length > 500 ||
    !methods.some((m) => m?.payment_type_id === "credit_card")
  )
    throw failure();
  const excluded = [
    ...new Set(
      methods
        .map((m) => m?.payment_type_id)
        .filter(
          (t): t is string =>
            typeof t === "string" &&
            /^[a-z_]{1,40}$/.test(t) &&
            !["credit_card", "account_money"].includes(t),
        ),
    ),
  ];
  const callback = new URL(
    checkoutPath(token, charge.clientSlug),
    config.appUrl,
  ).toString();
  const raw = await providerRequest(
    config,
    "/checkout/preferences",
    "POST",
    {
      items: [
        {
          id: charge.id,
          title: "Serviços Grupo Pomar",
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number((charge.amountCents / 100).toFixed(2)),
        },
      ],
      external_reference: charge.id,
      expires: true,
      expiration_date_to: charge.expiresAt,
      notification_url: new URL(
        "/api/webhooks/mercadopago",
        config.appUrl,
      ).toString(),
      back_urls: { success: callback, pending: callback, failure: callback },
      auto_return: "approved",
      payment_methods: {
        installments: 12,
        excluded_payment_types: excluded.map((id) => ({ id })),
      },
      statement_descriptor: "GRUPO POMAR",
    },
    fetcher,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw failure();
  const url = config.mode === "test" ? raw.sandbox_init_point : raw.init_point;
  const maxInstallments = Number(raw.payment_methods?.installments);
  const item = raw.items?.[0];
  const excludedResult = raw.payment_methods?.excluded_payment_types;
  if (
    String(raw.collector_id) !== config.collectorId ||
    String(raw.client_id) !== config.applicationId ||
    raw.external_reference !== charge.id ||
    typeof raw.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(raw.id) ||
    !isSafeCheckoutUrl(url) ||
    new URL(url).searchParams.get("pref_id") !== raw.id ||
    new URL(url).hostname.startsWith("sandbox.") !== (config.mode === "test") ||
    raw.expires !== true ||
    Date.parse(raw.expiration_date_to) !== Date.parse(charge.expiresAt) ||
    !Number.isSafeInteger(maxInstallments) ||
    maxInstallments < 1 ||
    maxInstallments > 12 ||
    !Array.isArray(raw.items) ||
    raw.items.length !== 1 ||
    item?.id !== charge.id ||
    item?.currency_id !== "BRL" ||
    Number(item?.quantity) !== 1 ||
    decimalCents(item?.unit_price) !== charge.amountCents ||
    !Array.isArray(excludedResult) ||
    excluded.some((id) => !excludedResult.some((m) => m?.id === id)) ||
    excludedResult.some((m) => m?.id === "credit_card") ||
    ["success", "pending", "failure"].some(
      (k) => raw.back_urls?.[k] !== callback,
    )
  )
    throw failure();
  return {
    preferenceId: raw.id as string,
    checkoutUrl: url as string,
    maxInstallments,
  };
}

// A public return URL never proves payment. Recover only authenticated results
// for the stored reference, then verify every payment individually as webhooks do.
export async function findCardPayments(
  config: BillingConfig,
  charge: PreparedCharge & { createdAt: string },
  fetcher: typeof fetch = fetch,
): Promise<VerifiedPayment[]> {
  const query = new URLSearchParams({
    external_reference: charge.id,
    sort: "date_created",
    criteria: "desc",
    range: "date_created",
    begin_date: new Date(Date.parse(charge.createdAt) - 300000).toISOString(),
    end_date: new Date().toISOString(),
    limit: "10",
    offset: "0",
  });
  const found = await providerRequest(
    config,
    `/v1/payments/search?${query}`,
    "GET",
    undefined,
    fetcher,
    undefined,
    5000,
  );
  if (
    !found ||
    !Array.isArray(found.results) ||
    found.results.length > 10 ||
    !Number.isSafeInteger(found.paging?.total) ||
    found.paging.total !== found.results.length
  )
    throw failure();
  const ids: string[] = [];
  for (const item of found.results) {
    const id = String(item?.id ?? "");
    if (
      !/^\d{1,30}$/.test(id) ||
      item.external_reference !== charge.id ||
      ids.includes(id)
    )
      throw failure();
    ids.push(id);
  }
  const payments = await Promise.all(
    ids.map((id) => fetchVerifiedPayment(config, id, fetcher)),
  );
  for (const p of payments)
    if (
      p.externalReference !== charge.id ||
      p.amountCents !== charge.amountCents ||
      p.mode !== charge.mode ||
      !["credit_card", "account_money"].includes(p.paymentMethod ?? "")
    )
      throw failure();
  return payments;
}
