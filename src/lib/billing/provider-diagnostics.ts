import type { BillingConfig } from "../config/billing.ts";
import { ProviderError } from "./mercadopago.ts";
import { verifyOrderAccount } from "./orders.ts";

const messages = {
  provider_ready:
    "Conta e ambiente do Mercado Pago conferidos. A criação do Pix ainda exige homologação.",
  provider_unavailable:
    "Não foi possível conferir o Mercado Pago neste momento.",
  provider_http_rejected:
    "O Mercado Pago recusou a consulta ou operação. Confira o status HTTP e as credenciais do ambiente.",
  provider_http_unavailable:
    "O Mercado Pago não confirmou a consulta ou operação neste momento.",
  provider_account_invalid:
    "O perfil da conta não veio no formato esperado. A criação permanece bloqueada.",
  provider_collector_mismatch:
    "A conta autenticada pelo Access Token não corresponde a POMAR_MP_COLLECTOR_ID. Confira os dois valores na mesma aplicação e ambiente.",
  provider_country_mismatch:
    "A conta autenticada não corresponde ao país Brasil esperado pela integração.",
  provider_environment_unverified:
    "O perfil da conta não permitiu conferir o ambiente de teste ou produção. A criação permanece bloqueada.",
  provider_environment_mismatch:
    "O ambiente da conta autenticada não corresponde a POMAR_PAYMENT_MODE. Confira as credenciais do ambiente correto.",
  provider_charge_invalid:
    "Os dados reservados da cobrança não passaram na conferência antes da criação.",
  provider_order_id_invalid:
    "O identificador da order não veio no formato esperado.",
  provider_order_response_invalid:
    "Os dados da order não passaram na conferência. Consulte o diagnóstico da integração.",
  provider_order_collector_mismatch:
    "O recebedor informado na order não corresponde à configuração da integração.",
  provider_application_mismatch:
    "A aplicação informada na order não corresponde a POMAR_MP_APPLICATION_ID.",
  provider_order_country_mismatch:
    "O país informado na order não corresponde ao Brasil.",
  provider_order_currency_mismatch:
    "A moeda informada na order não corresponde a BRL.",
  provider_order_environment_mismatch:
    "O ambiente informado na order não corresponde à configuração da integração.",
  provider_order_type_mismatch:
    "O tipo ou processamento da order não corresponde ao checkout integrado.",
} as const;

export type ProviderFailureCode = Exclude<
  keyof typeof messages,
  "provider_ready"
>;

export function providerErrorDetails(error: unknown) {
  let code: ProviderFailureCode = "provider_unavailable";
  const candidate: unknown =
    error instanceof ProviderError ? error.code : undefined;
  const status = error instanceof ProviderError ? error.status : undefined;
  if (
    typeof candidate === "string" &&
    candidate !== "provider_ready" &&
    Object.hasOwn(messages, candidate)
  )
    code = candidate as ProviderFailureCode;
  return {
    code,
    ...(error instanceof ProviderError
      ? {
          definitive: error.definitive === true,
          ...(typeof status === "number" &&
          Number.isInteger(status) &&
          status >= 100 &&
          status <= 599
            ? { status }
            : {}),
        }
      : {}),
  };
}

export async function inspectProviderAccount(
  config: BillingConfig,
  fetcher: typeof fetch = fetch,
) {
  try {
    await verifyOrderAccount(config, fetcher);
    return {
      enabled: true,
      mode: config.mode,
      code: "provider_ready" as const,
      message: messages.provider_ready,
    };
  } catch (error) {
    const details = providerErrorDetails(error);
    return {
      enabled: false,
      mode: config.mode,
      ...details,
      message: messages[details.code],
    };
  }
}
