import { authorizedOwner, requireOrigin } from "@/lib/server/access";
import { parseEnvironment } from "@/lib/config/environment";
import { json, errorResponse } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    const config = parseEnvironment(process.env);
    requireOrigin(request, config.appUrl);
    await authorizedOwner(false);
    return json({ active: true });
  } catch (error) {
    return errorResponse(error);
  }
}
