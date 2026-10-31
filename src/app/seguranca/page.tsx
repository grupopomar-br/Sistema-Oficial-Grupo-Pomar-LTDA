import { AuthLayout, SetupPage } from "@/components/auth-layout";
import { MfaForm } from "@/components/auth-forms";
import { ownerPage, AccessError } from "@/lib/server/access";
import { parseEnvironment, safeNext } from "@/lib/config/environment";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  try {
    parseEnvironment(process.env);
  } catch {
    return <SetupPage />;
  }
  let owner;
  try {
    owner = await ownerPage(false);
  } catch (error) {
    if (error instanceof AccessError)
      return <SetupPage message={error.message} />;
    throw error;
  }
  const next = safeNext((await searchParams).next);
  const factors = await owner.supabase.auth.mfa.listFactors();
  if (factors.error)
    return (
      <SetupPage message="Não foi possível conferir os autenticadores desta sessão." />
    );
  return (
    <AuthLayout>
      <span className="eyebrow">PROTEÇÃO DA OPERAÇÃO</span>
      <h2>
        {factors.data.totp.length
          ? "Confirme que é você."
          : "Ative seu segundo fator."}
      </h2>
      <p>
        {factors.data.totp.length
          ? "Use o código do seu aplicativo autenticador para continuar."
          : "Configure um aplicativo autenticador antes de acessar os dados. Guarde a configuração em um local protegido."}
      </p>
      <MfaForm
        factors={factors.data.totp.map((item) => ({
          id: item.id,
          name: item.friendly_name ?? "Seu autenticador",
        }))}
        next={next}
      />
    </AuthLayout>
  );
}
