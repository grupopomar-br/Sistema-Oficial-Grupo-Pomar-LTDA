import { parseMediaConfig } from "@/lib/config/media";
import { mediaRequest } from "@/lib/media/contracts";
import { AccessError, requireOrigin } from "@/lib/server/access";
import { boundedJson, errorResponse, json } from "@/lib/server/http";
import { processMediaRequest } from "@/lib/server/media";

export async function POST(request: Request) {
  try {
    const config = parseMediaConfig(process.env);
    if (!config.enabled)
      throw new AccessError("Envio privado indisponível.", 503);
    requireOrigin(request, config.appUrl);
    const input = mediaRequest.parse(await boundedJson(request, 8192));
    return json(await processMediaRequest(config, input));
  } catch (error) {
    return errorResponse(error);
  }
}
