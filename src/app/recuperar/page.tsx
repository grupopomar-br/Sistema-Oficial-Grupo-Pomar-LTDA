import { AuthLayout, SetupPage } from "@/components/auth-layout";
import { RecoveryForm } from "@/components/auth-forms";
import { parseEnvironment } from "@/lib/config/environment";
export default function Page() {
  try {
    parseEnvironment(process.env);
  } catch {
    return <SetupPage />;
  }
  return (
    <AuthLayout>
      <span className="eyebrow">RECUPERAR ACESSO</span>
      <h2>Retome sua operação.</h2>
      <p>
        Enviaremos as instruções para o e-mail cadastrado. O segundo fator
        continuará protegendo o acesso.
      </p>
      <RecoveryForm />
    </AuthLayout>
  );
}
