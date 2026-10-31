import type { ReactNode } from "react";
import { Shield } from "lucide-react";
import { Brand } from "./ui";
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <h1>
            Clareza para decidir.
            <br />
            <span>Estrutura para crescer.</span>
          </h1>
          <p>
            Seus clientes, compromissos e próximas ações conectados em um centro
            de operação.
          </p>
        </div>
        <span className="eyebrow">GRUPO POMAR · CENTRAL OPERACIONAL</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          {children}
          <div className="auth-note">
            <Shield size={16} />
            <span>Acesso exclusivo do proprietário · Grupo Pomar</span>
          </div>
        </div>
      </section>
    </main>
  );
}
export function SetupPage({
  message = "O ambiente está aguardando a configuração do acesso e do banco.",
}: {
  message?: string;
}) {
  return (
    <AuthLayout>
      <span className="eyebrow">CENTRAL OPERACIONAL</span>
      <h2>Acesso em configuração.</h2>
      <p>{message}</p>
      <div className="inline-note">
        O sistema será liberado depois da configuração e da validação dos
        acessos.
      </div>
    </AuthLayout>
  );
}
