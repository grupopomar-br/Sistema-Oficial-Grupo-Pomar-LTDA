import { Brand } from "@/components/ui";
export default function PaymentReturn() {
  return (
    <main className="payment-return">
      <Brand />
      <section className="panel">
        <span className="eyebrow">ATENDIMENTO GRUPO POMAR</span>
        <h1>Você retornou do checkout.</h1>
        <p>
          A confirmação do pagamento é feita diretamente com o provedor. Esta
          página não altera o estado financeiro da cobrança.
        </p>
        <p>
          Você pode fechar esta janela. Para conferir o atendimento, utilize o
          canal pelo qual já conversa com o Grupo Pomar.
        </p>
      </section>
    </main>
  );
}
