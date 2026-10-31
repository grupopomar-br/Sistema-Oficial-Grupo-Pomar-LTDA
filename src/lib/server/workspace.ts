import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseWorkspace } from "../domain/workspace";
import { camelize } from "../domain/transport";
export { databaseCommand } from "../domain/transport";

export class DatabaseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DatabaseError";
    this.status = status;
  }
}
export function databaseFailure(error: {
  code?: string;
  message?: string;
}): DatabaseError {
  const message = error.message ?? "";
  const messages: Record<string, string> = {
    POMAR_PAYMENT_GATE:
      "A condição de pagamento aceita ainda não foi atendida. Confira Cobranças antes de alterar a etapa.",
    POMAR_PROVIDER_RECEIPT:
      "Este recebimento é confirmado pelo provedor. Faça a devolução no provedor e concilie o evento.",
    POMAR_ACTIVE_CHARGE:
      "Já existe uma cobrança em andamento para esta parcela. Confira o link e a validade.",
    POMAR_BILLING_DISABLED:
      "A integração do banco para cobrança ainda não foi habilitada.",
    POMAR_RECENT_MFA:
      "Confirme novamente o autenticador para gerar um link de pagamento.",
    POMAR_CONFLICT:
      "Este registro mudou em outra sessão. Atualize os dados e revise antes de salvar.",
    POMAR_KEY_REUSED:
      "Esta tentativa já foi utilizada com outros dados. Feche o formulário e confira os registros antes de tentar novamente.",
    POMAR_OVERPAYMENT: "O recebimento supera o saldo desta parcela.",
    POMAR_NOT_ACTIVE:
      "O contrato, a parcela ou a oportunidade não está disponível para esta ação.",
    POMAR_NOT_FOUND: "O registro não foi encontrado. Atualize os dados.",
    POMAR_ALREADY_DATED:
      "O recebimento já tem uma data ou foi estornado. Atualize os dados.",
    POMAR_FUTURE_EXPENSE: "A data do pagamento não pode estar no futuro.",
    POMAR_FUTURE_DATE: "A data do recebimento não pode estar no futuro.",
    POMAR_IMMUTABLE:
      "Os valores originais deste registro financeiro são preservados. Use as ações de correção disponíveis.",
    POMAR_SNAPSHOT_LIMIT:
      "A operação atingiu o limite de registros desta versão. A consulta precisa ser ampliada antes de continuar.",
    POMAR_NOT_INITIALIZED:
      "A configuração do proprietário ainda precisa ser concluída no banco.",
    POMAR_ACCESS: "A sessão foi revogada ou o acesso não está autorizado.",
  };
  const known = Object.keys(messages).find((key) => message.includes(key));
  if (known)
    return new DatabaseError(
      messages[known],
      known === "POMAR_CONFLICT" || known === "POMAR_KEY_REUSED"
        ? 409
        : known === "POMAR_ACCESS"
          ? 403
          : 400,
    );
  if (error.code === "23505")
    return new DatabaseError(
      "Este registro já foi criado. Atualize os dados antes de tentar novamente.",
      409,
    );
  if (error.code === "42501")
    return new DatabaseError(
      "Esta sessão não tem permissão para executar a operação.",
      403,
    );
  if (error.code === "23503")
    return new DatabaseError(
      "Um vínculo deste registro deixou de existir. Atualize os dados.",
    );
  if (error.code === "23514" || error.code === "22023")
    return new DatabaseError("Revise os campos e os valores informados.");
  return new DatabaseError(
    "Não foi possível consultar ou salvar no banco. Confira a configuração e tente novamente.",
    503,
  );
}
export async function readWorkspace(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("pomar_workspace");
  if (error) throw databaseFailure(error);
  return parseWorkspace(camelize(data));
}
