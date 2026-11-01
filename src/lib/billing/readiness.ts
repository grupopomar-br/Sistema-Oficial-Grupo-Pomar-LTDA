type PaymentMode = "test" | "live";

const messages = {
  ready:
    "Conexão da cobrança conferida. Os pagamentos ainda exigem homologação no provedor.",
  disabled: "A integração está desativada na configuração da hospedagem.",
  configuration_invalid:
    "Existem variáveis ausentes ou inválidas na configuração da cobrança.",
  database_status_unavailable:
    "Não foi possível consultar a configuração de cobrança pela sessão da Central.",
  database_configuration_pending:
    "A configuração de cobrança ainda não está habilitada no banco.",
  payment_mode_mismatch:
    "O ambiente de pagamento da hospedagem não corresponde ao configurado no banco.",
  worker_configuration_mismatch:
    "A configuração do worker não confere com o proprietário, recebedor ou ambiente da Central.",
  pix_migration_pending:
    "O banco precisa das migrações da versão atual do checkout Pix.",
  worker_certificate_untrusted:
    "Não foi possível validar a cadeia do certificado do banco. Confira a CA oficial do Supabase na hospedagem.",
  worker_certificate_invalid:
    "O certificado TLS do banco está inválido. Confira o endpoint e o certificado oficial.",
  worker_authentication_failed:
    "O banco recusou o login do worker. Confira o usuário e a senha da conexão privada.",
  worker_permission_denied:
    "O worker não possui a permissão necessária. Confira as migrações e concessões do papel restrito.",
  worker_schema_missing:
    "As funções de cobrança desta versão não foram encontradas. Confira as migrações da Central.",
  worker_network_unavailable:
    "Não foi possível alcançar o pooler. Confira o host, a porta e a disponibilidade do projeto.",
  worker_unavailable:
    "Não foi possível conferir a conexão do worker. Consulte o diagnóstico técnico da hospedagem.",
  status_unavailable:
    "Não foi possível conferir o estado da integração neste momento.",
} as const;

export type BillingReadinessCode = keyof typeof messages;
export type BillingReadiness = {
  enabled: boolean;
  mode: PaymentMode | null;
  code: BillingReadinessCode;
  message: string;
  fields?: string[];
};

export function billingReadiness(
  mode: PaymentMode | null,
  code: BillingReadinessCode,
): BillingReadiness {
  return { enabled: code === "ready", mode, code, message: messages[code] };
}

const configurationFields = new Set([
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "POMAR_ENVIRONMENT",
  "POMAR_OWNER_USER_ID",
  "POMAR_PAYMENT_MODE",
  "POMAR_MP_ACCESS_TOKEN",
  "POMAR_MP_WEBHOOK_SECRET",
  "POMAR_MP_COLLECTOR_ID",
  "POMAR_MP_APPLICATION_ID",
  "POMAR_BILLING_DATABASE_URL",
  "POMAR_BILLING_DB_CA_BASE64",
  "POMAR_BILLING_LIVE_CONFIRMED",
]);

export function billingConfigurationFailure(fields: readonly string[]) {
  return {
    ...billingReadiness(null, "configuration_invalid"),
    fields: [
      ...new Set(fields.filter((field) => configurationFields.has(field))),
    ],
  };
}

const connectionCodes: Readonly<Record<string, BillingReadinessCode>> = {
  SELF_SIGNED_CERT_IN_CHAIN: "worker_certificate_untrusted",
  DEPTH_ZERO_SELF_SIGNED_CERT: "worker_certificate_untrusted",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "worker_certificate_untrusted",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "worker_certificate_untrusted",
  UNABLE_TO_GET_ISSUER_CERT: "worker_certificate_untrusted",
  ERR_TLS_CERT_ALTNAME_INVALID: "worker_certificate_invalid",
  CERT_HAS_EXPIRED: "worker_certificate_invalid",
  CERT_NOT_YET_VALID: "worker_certificate_invalid",
  ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED: "worker_certificate_invalid",
  "28P01": "worker_authentication_failed",
  "28000": "worker_authentication_failed",
  "42501": "worker_permission_denied",
  "42883": "worker_schema_missing",
  "42P01": "worker_schema_missing",
  "3F000": "worker_schema_missing",
  ENOTFOUND: "worker_network_unavailable",
  EAI_AGAIN: "worker_network_unavailable",
  ECONNREFUSED: "worker_network_unavailable",
  ECONNRESET: "worker_network_unavailable",
  ETIMEDOUT: "worker_network_unavailable",
  CONNECT_TIMEOUT: "worker_network_unavailable",
  CONNECTION_CLOSED: "worker_network_unavailable",
};

function connectionFailure(error: unknown): BillingReadinessCode {
  // Project only recognized codes, never driver text, queries, or credentials.
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") break;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (
      typeof candidate.code === "string" &&
      Object.hasOwn(connectionCodes, candidate.code)
    )
      return connectionCodes[candidate.code];
    current = candidate.cause;
  }
  return "worker_unavailable";
}

type ReadinessChecks = {
  ownerStatus: () => Promise<{
    data: { configured?: unknown; mode?: unknown } | null;
    error: unknown;
  }>;
  workerReady: () => Promise<boolean>;
  pixReady: () => Promise<boolean>;
};

export async function inspectBillingReadiness(
  mode: PaymentMode,
  checks: ReadinessChecks,
): Promise<BillingReadiness> {
  let stage: "owner" | "worker" | "pix" = "owner";
  try {
    const { data, error } = await checks.ownerStatus();
    if (error) return billingReadiness(mode, "database_status_unavailable");
    if (data?.configured !== true)
      return billingReadiness(mode, "database_configuration_pending");
    if (data.mode !== mode)
      return billingReadiness(mode, "payment_mode_mismatch");
    stage = "worker";
    if (!(await checks.workerReady()))
      return billingReadiness(mode, "worker_configuration_mismatch");
    stage = "pix";
    if (!(await checks.pixReady()))
      return billingReadiness(mode, "pix_migration_pending");
    return billingReadiness(mode, "ready");
  } catch (error) {
    return billingReadiness(
      mode,
      stage === "owner"
        ? "database_status_unavailable"
        : connectionFailure(error),
    );
  }
}
