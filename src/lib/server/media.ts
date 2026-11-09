import "server-only";
import { createHash } from "node:crypto";
import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaConfig } from "../config/media";
import { camelize } from "../domain/transport";
import {
  projectMediaSchema,
  type MediaRequest,
  type MediaType,
} from "../media/contracts";
import { mediaUploadUrl, verifyMediaObject } from "../media/r2";
import { AccessError } from "./access";
import { databaseFailure } from "./workspace";

let pool: { key: string; sql: ReturnType<typeof postgres> } | undefined;
function mediaDatabase(config: MediaConfig) {
  const key = config.databaseUrl + "\n" + (config.databaseCa ?? "");
  if (pool?.key !== key) {
    if (pool) void pool.sql.end({ timeout: 5 });
    pool = {
      key,
      sql: postgres(config.databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 8,
        idle_timeout: 20,
        max_lifetime: 300,
        ssl: {
          rejectUnauthorized: true,
          ...(config.databaseCa ? { ca: config.databaseCa } : {}),
        },
        onnotice: () => {},
      }),
    };
  }
  return pool.sql;
}

export const mediaTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function projectMedia(
  supabase: SupabaseClient,
  projectId: string,
  hash?: string | null,
) {
  const args = { p_project: projectId };
  const { data, error } =
    hash === undefined
      ? await supabase.rpc("pomar_media_project", args)
      : await supabase.rpc("pomar_media_set_link", { ...args, p_hash: hash });
  if (error?.code === "PGRST202")
    throw new AccessError(
      "A migração da Área VIP ainda precisa ser aplicada.",
      503,
    );
  if (error) throw databaseFailure(error);
  return projectMediaSchema.parse(camelize(data));
}

export async function processMediaRequest(
  config: MediaConfig,
  input: MediaRequest,
) {
  const hash = mediaTokenHash(input.token);
  const sql = mediaDatabase(config);
  try {
    if (input.action === "status") {
      const [row] =
        await sql`select pomar_private.media_link_status(${hash}) as link`;
      if (!row?.link)
        throw new AccessError("Link de envio expirado ou revogado.", 404);
      return { expiresAt: row.link.expires_at };
    }
    if (input.action === "reserve") {
      const file = input.file;
      const [row] =
        await sql`select pomar_private.media_reserve(${hash},${input.id}::uuid,
        ${file.fileName},${file.contentType},${file.sizeBytes}::integer) as reservation`;
      if (!row?.reservation)
        throw new AccessError("Link de envio expirado ou revogado.", 404);
      if (row.reservation.received === true) return { received: true };
      const remaining = Math.floor(
        (Date.parse(row.reservation.valid_until) - Date.now()) / 1000,
      );
      if (!(remaining >= 10))
        throw new AccessError(
          "Peça um novo link de envio para continuar.",
          410,
        );
      return await mediaUploadUrl(
        config,
        input.id,
        file,
        Math.min(600, remaining),
      );
    }
    const [row] =
      await sql`select pomar_private.media_check(${hash},${input.id}::uuid) as upload`;
    if (!row?.upload)
      throw new AccessError("Este envio não está disponível neste link.", 404);
    if (row.upload.received === true) return { received: true };
    const verified = await verifyMediaObject(config, input.id, {
      contentType: row.upload.content_type as MediaType,
      sizeBytes: Number(row.upload.size_bytes),
    });
    if (verified === "missing")
      throw new AccessError(
        "O R2 ainda não recebeu o arquivo. Tente novamente.",
        409,
      );
    if (verified === "invalid")
      throw new AccessError(
        "O tamanho ou o formato real do arquivo não confere.",
        422,
      );
    const [result] =
      await sql`select pomar_private.media_confirm(${hash},${input.id}::uuid) as confirmed`;
    if (result?.confirmed !== true)
      throw new AccessError(
        "O acesso foi encerrado antes da confirmação.",
        410,
      );
    return { received: true };
  } catch (error) {
    if (error instanceof AccessError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message === "POMAR_MEDIA_QUOTA")
      throw new AccessError(
        "O limite de armazenamento para este envio foi atingido.",
        413,
      );
    if (message === "POMAR_MEDIA_CHECK_LIMIT")
      throw new AccessError("O envio atingiu o limite de verificações.", 422);
    if (message === "POMAR_MEDIA_CHECK_WAIT")
      throw new AccessError(
        "Aguarde alguns segundos para tentar a confirmação novamente.",
        429,
      );
    if (message === "POMAR_KEY_REUSED")
      throw new AccessError(
        "Selecione o arquivo novamente para iniciar outro envio.",
        409,
      );
    throw new AccessError(
      "O envio privado está temporariamente indisponível.",
      503,
    );
  }
}
