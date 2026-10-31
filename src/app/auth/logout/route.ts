import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseEnvironment } from "@/lib/config/environment";
import { requireOrigin } from "@/lib/server/access";
export async function POST(request: Request) {
  let config;
  try {
    config = parseEnvironment(process.env);
    requireOrigin(request, config.appUrl);
  } catch {
    return new Response("Acesso indisponível.", { status: 403 });
  }
  const supabase = await createSupabaseServerClient(false);
  await supabase.rpc("pomar_lock_session");
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/entrar", config.appUrl), 303);
}
