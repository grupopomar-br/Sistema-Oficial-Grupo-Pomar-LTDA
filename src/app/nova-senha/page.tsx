import { AuthLayout, SetupPage } from "@/components/auth-layout";
import { PasswordForm } from "@/components/auth-forms";
import { ownerPage, AccessError } from "@/lib/server/access";
import { parseEnvironment } from "@/lib/config/environment";
export default async function Page() {
  try {
    parseEnvironment(process.env);
  } catch {
    return <SetupPage />;
  }
  try {
    await ownerPage(true, "/nova-senha");
  } catch (error) {
    if (error instanceof AccessError)
      return <SetupPage message={error.message} />;
    throw error;
  }
  return (
    <AuthLayout>
      <span className="eyebrow">ATUALIZAR SENHA</span>
      <h2>Reforce seu acesso.</h2>
      <p>
        Escolha uma senha exclusiva com pelo menos 12 caracteres. Você precisará
        entrar novamente depois.
      </p>
      <PasswordForm />
    </AuthLayout>
  );
}
