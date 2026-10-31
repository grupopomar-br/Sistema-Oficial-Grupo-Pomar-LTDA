import "server-only";
import { ZodError } from "zod";
import { AccessError } from "./access";
import { ConfigurationError } from "../config/environment";
import { DatabaseError } from "./workspace";
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function errorResponse(error: unknown) {
  if (error instanceof AccessError || error instanceof DatabaseError)
    return json(
      {
        error: error.message,
        ...(error instanceof AccessError && error.code
          ? { code: error.code }
          : {}),
      },
      error.status,
    );
  if (error instanceof ConfigurationError)
    return json(
      { error: "A conexão com a nuvem ainda não foi configurada." },
      503,
    );
  if (error instanceof ZodError)
    return json(
      { error: error.issues[0]?.message ?? "Revise os campos informados." },
      400,
    );
  return json(
    { error: "Não foi possível concluir esta operação. Tente novamente." },
    500,
  );
}
export async function boundedJson(
  request: Request,
  limit = 512 * 1024,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AccessError("Envie os dados em JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError("Requisição sem dados.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AccessError(
          `A requisição excede o limite de ${Math.round(limit / 1024)} KB.`,
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccessError("O JSON enviado é inválido.", 400);
  }
}
