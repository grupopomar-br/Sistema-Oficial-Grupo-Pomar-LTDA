import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseEnvironment, safeNext } from "@/lib/config/environment";
export async function GET(request: Request) {
  let config;
  try {
    config = parseEnvironment(process.env);
  } catch {
    return new Response("Ambiente não configurado.", { status: 503 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient(false);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext(url.searchParams.get("next")), config.appUrl),
      );
  }
  return NextResponse.redirect(
    new URL("/entrar?erro=recuperacao", config.appUrl),
  );
}
