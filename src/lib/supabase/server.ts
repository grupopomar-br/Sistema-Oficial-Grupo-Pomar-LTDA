import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { parseEnvironment } from "../config/environment";
export async function createSupabaseServerClient(readOnlyCookies = true) {
  const config = parseEnvironment(process.env);
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      secure: config.environment !== "development",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        if (readOnlyCookies) return;
        values.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}
