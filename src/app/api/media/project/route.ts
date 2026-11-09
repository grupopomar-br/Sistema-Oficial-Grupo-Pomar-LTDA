import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ConfigurationError, parseEnvironment } from "@/lib/config/environment";
import { parseMediaConfig } from "@/lib/config/media";
import { authorizedOwner, requireOrigin } from "@/lib/server/access";
import { boundedJson, errorResponse, json } from "@/lib/server/http";
import {
  mediaTokenHash,
  projectMedia,
  removeProjectMedia,
} from "@/lib/server/media";

const schema = z.discriminatedUnion("action", [
  z.strictObject({
    projectId: z.uuid(),
    action: z.enum(["status", "rotate", "revoke"]),
  }),
  z.strictObject({
    projectId: z.uuid(),
    action: z.literal("remove"),
    id: z.uuid(),
  }),
]);

export async function POST(request: Request) {
  let ownerAuthorized = false;
  try {
    const app = parseEnvironment(process.env);
    requireOrigin(request, app.appUrl);
    const { supabase } = await authorizedOwner(false);
    ownerAuthorized = true;
    const input = schema.parse(await boundedJson(request, 8192));
    const config = parseMediaConfig(process.env);
    if (!config.enabled) return json({ available: false });
    if (input.action === "remove")
      await removeProjectMedia(supabase, config, input.projectId, input.id);
    if (input.action === "status" || input.action === "remove")
      return json({
        available: true,
        project: await projectMedia(supabase, input.projectId),
      });
    if (input.action === "revoke")
      return json({
        available: true,
        project: await projectMedia(supabase, input.projectId, null),
      });
    const token = randomBytes(32).toString("base64url");
    const project = await projectMedia(
      supabase,
      input.projectId,
      mediaTokenHash(token),
    );
    const link = new URL("/envio-vip", config.appUrl);
    link.hash = token;
    return json({ available: true, project, link: link.toString() });
  } catch (error) {
    if (ownerAuthorized && error instanceof ConfigurationError)
      return json(
        { error: `Revise na Vercel ${error.fields.join(", ")}.` },
        503,
      );
    return errorResponse(error);
  }
}
