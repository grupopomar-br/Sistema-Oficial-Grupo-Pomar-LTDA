import { AuthLayout } from "@/components/auth-layout";
export default function NotFound() {
  return (
    <AuthLayout>
      <span className="eyebrow">CENTRAL OPERACIONAL</span>
      <h2>Essa página não está disponível.</h2>
      <p>Confira o endereço ou volte para o início do sistema.</p>
      <a className="button button-primary" href="/">
        Voltar ao início
      </a>
    </AuthLayout>
  );
}
