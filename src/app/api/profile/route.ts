import { z } from "zod";
import {
  authorizedOwner,
  requireOrigin,
  AccessError,
} from "@/lib/server/access";
import {
  databaseCommand,
  databaseFailure,
  readWorkspace,
} from "@/lib/server/workspace";
import { json, errorResponse } from "@/lib/server/http";
import {
  normalizeProfileImage,
  profileBytes,
  ProfileImageError,
} from "@/lib/profile/image";
import { avatarPathSchema } from "@/lib/domain/personalization";

export const runtime = "nodejs";
const bucket = "pomar-profile";
const headersSchema = z.strictObject({
  action: z.enum(["upload", "brand", "remove"]),
  expectedVersion: z.coerce.number().int().min(0),
  commandId: z.uuid(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user, config } = await authorizedOwner(false);
    requireOrigin(request, config.appUrl);
    const headerVersion = request.headers.get("x-profile-version");
    if (!headerVersion || !/^\d{1,9}$/.test(headerVersion))
      throw new AccessError("Atualize os dados antes de trocar a foto.", 400);
    const input = headersSchema.parse({
      action: request.headers.get("x-profile-action"),
      expectedVersion: headerVersion,
      commandId: request.headers.get("x-command-id"),
    });
    const before = await readWorkspace(supabase);
    if (!before.personalizationReady)
      throw new AccessError(
        "A configuração de perfil ainda precisa ser ativada na sua conta.",
        503,
      );
    if (before.profile.version !== input.expectedVersion)
      throw new AccessError(
        "A foto mudou em outra sessão. Atualize e tente novamente.",
        409,
      );
    let path = input.action === "brand" ? "brand" : "";
    if (input.action === "upload") {
      const image = await normalizeProfileImage(
        await profileBytes(request.body),
      );
      path = `${user.id}/${input.commandId}.webp`;
      const upload = await supabase.storage.from(bucket).upload(path, image, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "0",
      });
      if (upload.error)
        throw new AccessError(
          "Não foi possível guardar a imagem. Atualize os dados e confira a configuração do perfil.",
          503,
        );
    }
    const { error } = await supabase.rpc("pomar_command", {
      p_key: input.commandId,
      p_command: databaseCommand({
        type: "saveProfile",
        avatarPath: path,
        expectedVersion: input.expectedVersion,
      }),
    });
    if (error) {
      // A network timeout can follow a commit. Preserve the object unless the
      // database explicitly reports a rolled-back conflict/validation failure.
      if (
        input.action === "upload" &&
        ["23514", "22023", "P0001", "42501"].includes(error.code)
      )
        await supabase.storage.from(bucket).remove([path]);
      throw databaseFailure(error);
    }
    const old = before.profile.avatarPath;
    if (old && old !== "brand" && old !== path)
      await supabase.storage.from(bucket).remove([old]);
    return json({ workspace: await readWorkspace(supabase) });
  } catch (error) {
    return errorResponse(
      error instanceof ProfileImageError
        ? new AccessError(error.message, 400)
        : error,
    );
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authorizedOwner(false);
    const path = avatarPathSchema.parse(
      new URL(request.url).searchParams.get("path"),
    );
    if (!path.startsWith(`${user.id}/`))
      throw new AccessError("Imagem indisponível.", 404);
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw new AccessError("Imagem indisponível.", 404);
    return new Response(await data.arrayBuffer(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
