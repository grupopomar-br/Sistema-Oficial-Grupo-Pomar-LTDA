"use client";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <AuthLayout>
      <span className="eyebrow">CENTRAL OPERACIONAL</span>
      <h2>Não foi possível abrir esta tela.</h2>
      <p>
        Seus registros não foram substituídos. Tente carregar novamente para
        continuar.
      </p>
      <div className="button-group">
        <Button variant="primary" onClick={reset}>
          Tentar novamente
        </Button>
        <a className="button button-secondary" href="/">
          Voltar ao início
        </a>
      </div>
    </AuthLayout>
  );
}
