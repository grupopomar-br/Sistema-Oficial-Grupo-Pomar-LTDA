"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseEnvironment, safeNext } from "@/lib/config/environment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifiedOwner, authorizedOwner } from "@/lib/server/access";
export type AuthState = { error?: string; success?: string };
async function actionOrigin() {
  const config = parseEnvironment(process.env);
  const origin = (await headers()).get("origin");
  if (origin !== new URL(config.appUrl).origin)
    throw new Error("Origem não autorizada.");
  return config;
}
export async function signIn(
  _previous: AuthState,
  form: FormData,
): Promise<AuthState> {
  let config;
  try {
    config = await actionOrigin();
  } catch {
    return {
      error:
        "O acesso ainda precisa de configuração ou o endereço não corresponde ao ambiente.",
    };
  }
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1).max(200) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Informe e-mail e senha válidos." };
  const supabase = await createSupabaseServerClient(false);
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user)
    return { error: "Não foi possível entrar com os dados informados." };
  if (data.user.id !== config.ownerUserId) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Este usuário não está autorizado a acessar a Central." };
  }
  redirect("/seguranca");
}
export async function requestPasswordReset(
  _previous: AuthState,
  form: FormData,
): Promise<AuthState> {
  let config;
  try {
    config = await actionOrigin();
  } catch {
    return {
      error: "A recuperação ainda precisa de configuração do ambiente.",
    };
  }
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  const supabase = await createSupabaseServerClient(false);
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${new URL(config.appUrl).origin}/auth/callback?next=/nova-senha`,
  });
  return {
    success:
      "Se esse e-mail estiver cadastrado e puder receber mensagens, você receberá as instruções de recuperação.",
  };
}
export async function enrollMfa(): Promise<{
  error?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
}> {
  try {
    await actionOrigin();
    const owner = await verifiedOwner(false);
    const factors = await owner.supabase.auth.mfa.listFactors();
    if (factors.error)
      return { error: "Não foi possível conferir os autenticadores." };
    if (factors.data.totp.length)
      return {
        error:
          "Já existe um autenticador verificado. Utilize seu código para entrar.",
      };
    const { data, error } = await owner.supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Central Pomar ${new Date().toISOString().slice(0, 16)}`,
    });
    if (error || !data)
      return {
        error:
          "Não foi possível iniciar o autenticador. Revise os fatores pendentes no painel do Supabase.",
      };
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    };
  } catch {
    return {
      error:
        "Sua sessão não permite configurar o autenticador. Entre novamente.",
    };
  }
}
export async function verifyMfa(
  _previous: AuthState,
  form: FormData,
): Promise<AuthState> {
  try {
    await actionOrigin();
    const owner = await verifiedOwner(false);
    const parsed = z
      .object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
      .safeParse({ factorId: form.get("factorId"), code: form.get("code") });
    if (!parsed.success)
      return { error: "Informe o código de seis dígitos do autenticador." };
    const { error } = await owner.supabase.auth.mfa.challengeAndVerify(
      parsed.data,
    );
    if (error)
      return {
        error:
          "O código não foi aceito. Confira o autenticador e tente novamente.",
      };
  } catch {
    return { error: "Não foi possível validar a sessão. Entre novamente." };
  }
  redirect(safeNext(form.get("next")));
}
export async function changePassword(
  _previous: AuthState,
  form: FormData,
): Promise<AuthState> {
  try {
    await actionOrigin();
    const owner = await authorizedOwner(false);
    const parsed = z
      .object({
        password: z.string().min(12).max(128),
        confirmation: z.string(),
      })
      .refine((value) => value.password === value.confirmation)
      .safeParse({
        password: form.get("password"),
        confirmation: form.get("confirmation"),
      });
    if (!parsed.success)
      return {
        error: "Use pelo menos 12 caracteres e confirme a mesma senha.",
      };
    const { error } = await owner.supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error)
      return {
        error:
          "Não foi possível atualizar a senha. Verifique os critérios do projeto.",
      };
    await owner.supabase.auth.signOut({ scope: "global" });
  } catch {
    return {
      error: "Confirme sua sessão e o segundo fator antes de alterar a senha.",
    };
  }
  redirect("/entrar?senha=atualizada");
}
