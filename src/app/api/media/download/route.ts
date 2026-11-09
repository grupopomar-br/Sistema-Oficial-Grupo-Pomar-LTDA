import { z } from "zod";
import { parseMediaConfig } from "@/lib/config/media";
import { mediaDownloadUrl } from "@/lib/media/r2";
import { AccessError, authorizedOwner } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/http";
import { projectMedia } from "@/lib/server/media";

export async function GET(request: Request) {
  try {
    const { supabase } = await authorizedOwner(false);
    const config = parseMediaConfig(process.env);
    if (!config.enabled)
      throw new AccessError("A Área VIP está indisponível.", 503);
    const params = new URL(request.url).searchParams;
    const id = z.uuid().parse(params.get("id"));
    const projectId = z.uuid().parse(params.get("projectId"));
    const project = await projectMedia(supabase, projectId);
    if (
      project.removingIds?.includes(id) ||
      !project.files.some((file) => file.id === id)
    )
      throw new AccessError("Arquivo não encontrado neste projeto.", 404);
    return new Response(null, {
      status: 303,
      headers: {
        Location: await mediaDownloadUrl(config, id),
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
