import { LockKeyhole, ShieldCheck } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import styles from "./payment-checkout.module.css";

export default function PaymentCheckoutLoading() {
  return (
    <main className={styles.page} aria-busy="true">
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <BrandLogo className={styles.wordmark} eager />
            <small>Pagamentos</small>
          </div>
          <span className={styles.secure}>
            <LockKeyhole size={14} />
            <span>Ambiente de pagamento</span>
          </span>
        </header>
        <div className={styles.layout}>
          <section className={styles.summary}>
            <div className={styles.eyebrow}>PAGAMENTOS GRUPO POMAR</div>
            <h1>
              Seu pagamento,
              <br />
              <span>com tranquilidade.</span>
            </h1>
            <p className={styles.intro}>
              Uma etapa simples para seguirmos em frente.
            </p>
            <div className={styles.loadingReceipt} role="status">
              Conferindo sua cobrança…
            </div>
          </section>
          <section className={styles.payment} aria-label="Carregando pagamento">
            <div className={styles.paymentBody}>
              <div className={styles.loadingState}>
                <ShieldCheck size={32} />
                <h2>Estamos abrindo seu pagamento.</h2>
                <p>Conferindo o valor e as opções desta cobrança.</p>
                <div className={styles.loadingLine} aria-hidden="true" />
              </div>
            </div>
            <footer className={styles.processor}>
              <ShieldCheck size={16} />
              <span>
                Pagamento processado por <strong>Mercado Pago</strong>
              </span>
            </footer>
          </section>
        </div>
      </div>
    </main>
  );
}
