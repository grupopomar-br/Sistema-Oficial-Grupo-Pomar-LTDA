import { AuthLayout, SetupPage } from "@/components/auth-layout";
import { LoginForm } from "@/components/auth-forms";
import { parseEnvironment } from "@/lib/config/environment";
export default function Page() {
  try {
    parseEnvironment(process.env);
  } catch {
    return <SetupPage />;
  }
  return (
    <AuthLayout>
      <span className="eyebrow">BEM-VINDO À SUA CENTRAL</span>
      <h2>Seu próximo passo começa aqui.</h2>
      <p>Entre com a conta de proprietário para acessar a operação.</p>
      <LoginForm />
    </AuthLayout>
  );
}
