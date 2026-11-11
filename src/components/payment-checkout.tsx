"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Copy,
  CreditCard,
  Loader2,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { PixCheckout } from "@/lib/billing/pix-contract";
import { money } from "@/lib/domain/dates";
import styles from "./payment-checkout.module.css";
import { BrandLogo } from "./brand-logo";
import { isSafeCheckoutUrl } from "@/lib/billing/safety";
import { watchCheckoutPayment } from "@/lib/billing/checkout-polling";
import PaymentCountdown from "./payment-countdown";

function PaymentBrand() {
  return (
    <div className={styles.brand}>
      <BrandLogo className={styles.wordmark} eager />
      <small>Pagamentos</small>
    </div>
  );
}
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));

export default function PaymentCheckout({
  initial,
  token,
  clientSlug,
  preview = false,
  loadFailed = false,
}: {
  initial: PixCheckout | null;
  token?: string;
  clientSlug?: string;
  preview?: boolean;
  loadFailed?: boolean;
}) {
  const [checkout, setCheckout] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [choice, setChoice] = useState<"pix" | "card">("pix");
  const locked = useRef(false);
  const code = useRef<HTMLTextAreaElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (
      !checkout ||
      !["ready", "pending", "processing"].includes(checkout.status)
    )
      return;
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      const remaining = Date.parse(checkout.expiresAt) - Date.now();
      setDeadlinePassed(remaining <= 0);
      if (remaining > 0)
        timer = window.setTimeout(
          check,
          Math.min(remaining + 1, 2_147_483_647),
        );
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkout?.expiresAt, checkout?.status]);
  const request = useCallback(
    async (body: unknown, silent = false) => {
      if (!token || locked.current) return;
      locked.current = true;
      if (!silent) {
        setBusy(true);
        setError("");
      }
      try {
        const response = await fetch(`/api/checkout/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error ?? "Não foi possível conferir o pagamento agora.",
          );
        setCheckout(data.checkout);
        setError("");
        return data.checkout as PixCheckout;
      } catch (failure) {
        if (!silent)
          setError(
            failure instanceof Error && failure.name !== "TimeoutError"
              ? failure.message
              : "A consulta demorou mais que o esperado. Confira novamente neste mesmo link.",
          );
      } finally {
        locked.current = false;
        if (!silent) setBusy(false);
      }
    },
    [token],
  );
  useEffect(() => {
    if (preview || !["pending", "processing"].includes(checkout?.status ?? ""))
      return;
    return watchCheckoutPayment(
      () => void request({ action: "refresh" }, true),
    );
  }, [checkout?.status, preview, request]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  const expired =
    checkout?.status === "expired" ||
    (deadlinePassed &&
      ["ready", "pending", "processing"].includes(checkout?.status ?? ""));
  const status = expired ? "expired" : checkout?.status;
  const paid = status === "paid";
  const cardMode =
    checkout?.paymentMethod === "card" ||
    (status === "ready" && choice === "card");
  const unavailable = !checkout;
  const terminal =
    paid || ["closed", "expired", "review"].includes(status ?? "");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await request({
      action: "generate",
      payer: {
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        document: String(data.get("document") ?? ""),
      },
    });
  }
  async function copy() {
    if (!checkout?.qrCode || preview || expired) return;
    try {
      await navigator.clipboard.writeText(checkout.qrCode);
      setCopied(true);
    } catch {
      code.current?.focus();
      code.current?.select();
      setError(
        "Selecione o código abaixo e copie para pagar no aplicativo do seu banco.",
      );
    }
  }
  async function startCard() {
    const next = await request({ action: "card", clientSlug });
    if (next?.cardUrl && isSafeCheckoutUrl(next.cardUrl))
      window.location.assign(next.cardUrl);
  }
  function showPreview() {
    if (checkout)
      setCheckout({
        ...checkout,
        status: checkout.status === "ready" ? "pending" : "ready",
      });
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <PaymentBrand />
          <span className={styles.secure}>
            <LockKeyhole size={14} />
            <span>Ambiente de pagamento</span>
          </span>
        </header>
        {(preview || checkout?.isTest) && (
          <div className={styles.preview} role="status">
            <span className={styles.dot} />
            {preview
              ? "PRÉVIA VISUAL · Nenhuma cobrança é criada nesta página."
              : "AMBIENTE DE TESTE · Este pagamento não quita uma cobrança real."}
          </div>
        )}
        <div className={styles.layout}>
          <section className={styles.summary} aria-labelledby="payment-title">
            <div className={styles.eyebrow}>PAGAMENTOS GRUPO POMAR</div>
            <h1 id="payment-title">
              Seu pagamento,
              <br />
              <span>com tranquilidade.</span>
            </h1>
            <p className={styles.intro}>
              Uma etapa simples para seguirmos em frente.
            </p>
            {checkout && (
              <article className={styles.receipt}>
                <div className={styles.receiptTop}>
                  <span className={styles.receiptIcon}>
                    <QrCode size={19} />
                  </span>
                  <span>Resumo do pagamento</span>
                  <span className={styles.pill}>
                    {cardMode ? "Cartão" : "Pix"}
                  </span>
                </div>
                <h2>{checkout.description}</h2>
                <p className={styles.reference}>
                  Referência {checkout.reference}
                </p>
                <div className={styles.total}>
                  <span>Valor do pagamento</span>
                  <strong>{money(checkout.amountCents)}</strong>
                  <small>
                    {cardMode
                      ? "Valor da cobrança. As condições de parcelamento serão exibidas no Mercado Pago."
                      : "Valor definido na sua cobrança."}
                  </small>
                </div>
                <div className={styles.validity}>
                  <Clock3 size={15} />
                  <span>
                    Link válido até <strong>{date(checkout.expiresAt)}</strong>
                  </span>
                </div>
              </article>
            )}
            <div className={styles.assurance}>
              <ShieldCheck size={22} />
              <p>
                <strong>
                  {cardMode
                    ? "Seu pagamento, com segurança."
                    : "Do seu banco, direto para o pagamento."}
                </strong>
                <span>
                  {cardMode
                    ? "Você informa o cartão no ambiente do Mercado Pago e confere as condições antes de confirmar."
                    : "O Pix é processado pelo Mercado Pago. A confirmação aparece aqui após a verificação."}
                </span>
              </p>
            </div>
            <p className={styles.help}>
              Precisa de ajuda? Fale com quem enviou este link.
            </p>
          </section>

          <section className={styles.payment} aria-labelledby="pix-title">
            <div className={styles.steps} aria-label="Etapas do pagamento">
              <span
                className={
                  status === "ready" ? styles.current : styles.finished
                }
              >
                <i>
                  {status !== "ready" && checkout ? <Check size={12} /> : "1"}
                </i>
                {cardMode ? "Forma de pagamento" : "Seus dados"}
              </span>
              <b />
              <span
                className={
                  status === "pending" || status === "processing"
                    ? styles.current
                    : paid
                      ? styles.finished
                      : ""
                }
              >
                <i>{paid ? <Check size={12} /> : "2"}</i>Pagamento
              </span>
              <b />
              <span className={paid ? styles.current : ""}>
                <i>3</i>Pronto
              </span>
            </div>
            <div className={styles.paymentBody}>
              <div className={styles.method}>
                <span>
                  {cardMode ? <CreditCard size={26} /> : <QrCode size={26} />}
                </span>
                <div>
                  <h2 id="pix-title">
                    {paid
                      ? "Tudo certo por aqui."
                      : cardMode
                        ? "Pague com cartão"
                        : "Pague com Pix"}
                  </h2>
                  <p>
                    {cardMode
                      ? "Conclua com segurança no Mercado Pago."
                      : "Simples, direto e pelo seu banco."}
                  </p>
                </div>
              </div>
              {status === "ready" &&
                checkout?.cardEnabled &&
                !checkout.paymentMethod && (
                  <div
                    className={styles.paymentOptions}
                    role="group"
                    aria-label="Forma de pagamento"
                  >
                    <button
                      type="button"
                      aria-pressed={choice === "pix"}
                      onClick={() => setChoice("pix")}
                      disabled={busy}
                    >
                      <QrCode size={18} />
                      <span>
                        Pix<small>Direto pelo seu banco</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={choice === "card"}
                      onClick={() => setChoice("card")}
                      disabled={busy}
                    >
                      <CreditCard size={18} />
                      <span>
                        Cartão
                        <small>
                          Em até {checkout.maxInstallments ?? 12}x no Mercado
                          Pago
                        </small>
                      </span>
                    </button>
                  </div>
                )}

              {unavailable ? (
                <div className={styles.state} role="status">
                  <span className={styles.stateIcon}>
                    <LockKeyhole size={30} />
                  </span>
                  <h3>
                    {loadFailed
                      ? "Vamos tentar novamente?"
                      : "Este link não está disponível."}
                  </h3>
                  <p>
                    {loadFailed
                      ? "Não foi possível abrir a cobrança agora. Tente novamente neste mesmo link."
                      : "Confira o endereço recebido ou solicite um novo link ao Grupo Pomar."}
                  </p>
                  {loadFailed && (
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => window.location.reload()}
                    >
                      <RefreshCw size={16} />
                      Tentar novamente
                    </button>
                  )}
                </div>
              ) : terminal ? (
                <div className={styles.state} role="status" aria-live="polite">
                  <span className={styles.stateIcon}>
                    {paid ? (
                      <CheckCheck size={36} />
                    ) : status === "review" ? (
                      <ShieldCheck size={32} />
                    ) : (
                      <Clock3 size={32} />
                    )}
                  </span>
                  <h3>
                    {paid
                      ? checkout.isTest
                        ? "Simulação confirmada."
                        : "Pagamento confirmado!"
                      : status === "review"
                        ? "Pagamento em conferência."
                        : status === "expired"
                          ? "Este link expirou."
                          : "Esta cobrança foi encerrada."}
                  </h3>
                  <p>
                    {paid
                      ? checkout.isTest
                        ? "O teste foi identificado. Nenhum recebimento real foi registrado."
                        : "Recebemos a confirmação do Mercado Pago. Obrigado por seguir com o Grupo Pomar."
                      : status === "review"
                        ? "Estamos conferindo os dados do pagamento. Fale com o Grupo Pomar antes de fazer outra tentativa."
                        : "Solicite um novo link ao Grupo Pomar para continuar. Se você já pagou, confira o status abaixo."}
                  </p>
                  {paid && (
                    <strong className={styles.paidAmount}>
                      {money(checkout.amountCents)}
                    </strong>
                  )}
                  {!paid && token && (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void request({ action: "refresh" })}
                    >
                      <RefreshCw size={16} />
                      Conferir pagamento
                    </button>
                  )}
                </div>
              ) : status === "processing" ? (
                <div className={styles.state} role="status" aria-live="polite">
                  <RefreshCw size={38} className={styles.spin} />
                  <h3>
                    {cardMode
                      ? "Estamos preparando seu checkout."
                      : "Estamos preparando seu Pix."}
                  </h3>
                  <p>
                    O Mercado Pago está processando a solicitação. Aguarde nesta
                    página; seu pedido será mantido.
                  </p>
                  <button
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => void request({ action: "refresh" })}
                  >
                    {busy ? "Conferindo…" : "Conferir novamente"}
                  </button>
                  {cardMode && checkout.cardEnabled && (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void startCard()}
                    >
                      Continuar no Mercado Pago
                    </button>
                  )}
                </div>
              ) : cardMode ? (
                <div className={styles.cardPanel}>
                  <span className={styles.stateIcon}>
                    <CreditCard size={34} />
                  </span>
                  <h3>Escolha como parcelar.</h3>
                  <p>
                    Opções em até {checkout.maxInstallments ?? 12} parcelas,
                    conforme o cartão, o valor e as condições disponíveis no
                    Mercado Pago.
                  </p>
                  <div className={styles.cardConditions}>
                    <ShieldCheck size={19} />
                    <span>
                      Confira o valor de cada parcela, os juros e o total antes
                      de confirmar. Dados do cartão são preenchidos no Mercado
                      Pago.
                    </span>
                  </div>
                  {checkout.cardUrl && isSafeCheckoutUrl(checkout.cardUrl) ? (
                    <a
                      className={styles.primary}
                      href={checkout.cardUrl}
                      rel="noreferrer"
                    >
                      Continuar no Mercado Pago
                      <ArrowRight size={17} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy || !checkout.cardEnabled || preview}
                      onClick={() => void startCard()}
                    >
                      {busy ? (
                        <Loader2 size={18} className={styles.spin} />
                      ) : (
                        <CreditCard size={18} />
                      )}
                      Continuar no Mercado Pago
                    </button>
                  )}
                  <span className={styles.buttonNote}>
                    Você pode voltar a este link para conferir a confirmação.
                  </span>
                  {status === "pending" && (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void request({ action: "refresh" })}
                    >
                      <RefreshCw size={16} />
                      Já paguei. Conferir pagamento
                    </button>
                  )}
                </div>
              ) : status === "ready" ? (
                <>
                  <div className={styles.formHeading}>
                    <h3>Vamos identificar seu pagamento.</h3>
                    <p>Preencha os dados do pagador para gerar o Pix.</p>
                  </div>
                  <form onSubmit={generate} className={styles.form}>
                    <label>
                      Nome completo
                      <input
                        name="name"
                        autoComplete="name"
                        enterKeyHint="next"
                        placeholder="Como você se chama?"
                        minLength={3}
                        maxLength={120}
                        required
                        disabled={busy || preview}
                      />
                    </label>
                    <label>
                      E-mail
                      <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        enterKeyHint="next"
                        placeholder="seu@email.com"
                        maxLength={254}
                        required
                        disabled={busy || preview}
                      />
                    </label>
                    <label>
                      CPF ou CNPJ
                      <input
                        name="document"
                        inputMode="numeric"
                        autoComplete="off"
                        enterKeyHint="go"
                        placeholder="Documento do pagador"
                        maxLength={24}
                        required
                        disabled={busy || preview}
                      />
                    </label>
                    <p className={styles.dataNote}>
                      <LockKeyhole size={13} />
                      Dados utilizados para identificar este pagamento.
                    </p>
                    {preview ? (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={showPreview}
                      >
                        Ver aparência do Pix
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className={styles.primary}
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Loader2 className={styles.spin} size={18} />
                            Preparando seu Pix…
                          </>
                        ) : (
                          <>
                            Gerar Pix de {money(checkout.amountCents)}
                            <ArrowRight size={17} />
                          </>
                        )}
                      </button>
                    )}
                    <span className={styles.buttonNote}>
                      O pagamento é feito no aplicativo do seu banco.
                    </span>
                  </form>
                </>
              ) : (
                <div className={styles.qrPanel}>
                  <div className={styles.waiting}>
                    <span className={styles.dot} />
                    Aguardando seu pagamento
                  </div>
                  <h3>Abra seu banco. Falta só confirmar.</h3>
                  <p>
                    No celular, copie o código Pix. Em outro dispositivo,
                    escaneie o QR Code.
                  </p>
                  <div className={styles.qr}>
                    {preview ? (
                      <div className={styles.qrPreview}>
                        <QrCode size={136} strokeWidth={1.1} />
                        <strong>PRÉVIA</strong>
                        <span>QR Code disponível na cobrança</span>
                      </div>
                    ) : checkout.qrBase64 ? (
                      <img
                        src={`data:image/png;base64,${checkout.qrBase64}`}
                        width={208}
                        height={208}
                        alt="QR Code Pix deste pagamento"
                      />
                    ) : (
                      <div className={styles.qrPreview}>
                        <RefreshCw size={42} />
                        <span>Use o código Pix Copia e Cola abaixo.</span>
                      </div>
                    )}
                  </div>
                  <span className={styles.timer}>
                    <Clock3 size={14} />
                    Válido por{" "}
                    <PaymentCountdown expiresAt={checkout.expiresAt} />
                  </span>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void copy()}
                    disabled={preview || !checkout.qrCode}
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
                    {copied ? "Código Pix copiado" : "Copiar código Pix"}
                  </button>
                  <span role="status" className={styles.copyStatus}>
                    {copied
                      ? "Agora abra seu banco e escolha Pix Copia e Cola."
                      : ""}
                  </span>
                  {!preview && checkout.qrCode && (
                    <details className={styles.codeDetails}>
                      <summary>
                        Ver código Pix
                        <ChevronDown size={14} />
                      </summary>
                      <textarea
                        ref={code}
                        readOnly
                        value={checkout.qrCode}
                        aria-label="Código Pix Copia e Cola"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </details>
                  )}
                  {preview ? (
                    <button className={styles.secondary} onClick={showPreview}>
                      Voltar para os dados
                    </button>
                  ) : (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void request({ action: "refresh" })}
                    >
                      <RefreshCw
                        size={15}
                        className={busy ? styles.spin : ""}
                      />
                      {busy ? "Conferindo…" : "Já paguei. Conferir pagamento"}
                    </button>
                  )}
                  <p className={styles.bankNote}>
                    Confira o recebedor e o valor no banco antes de confirmar. A
                    atualização desta página acontece automaticamente.
                  </p>
                </div>
              )}
              {error && (
                <p
                  className={styles.error}
                  ref={errorBox}
                  tabIndex={-1}
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
            <footer className={styles.processor}>
              <ShieldCheck size={16} />
              <span>
                Pagamento processado por <strong>Mercado Pago</strong>
              </span>
            </footer>
          </section>
        </div>
        <section
          className={styles.questions}
          aria-label="Ajuda com o pagamento"
        >
          <details>
            <summary>
              {cardMode
                ? "Como funciona o parcelamento?"
                : "Como pagar usando o mesmo celular?"}
              <ChevronDown size={16} />
            </summary>
            <p>
              {cardMode
                ? "Continue no Mercado Pago, selecione o cartão e confira as parcelas disponíveis, os juros e o valor total antes de confirmar. As opções dependem do cartão e do valor da cobrança."
                : "Toque em Copiar código Pix, abra o aplicativo do seu banco e escolha Pix Copia e Cola. Cole o código, confira os dados e confirme no banco."}
            </p>
          </details>
          <details>
            <summary>
              Como sei que o pagamento foi confirmado?
              <ChevronDown size={16} />
            </summary>
            <p>
              Esta página consulta o status do pagamento e mostra a confirmação
              recebida do Mercado Pago. Se já pagou, mantenha este link e use o
              botão de conferência.
            </p>
          </details>
        </section>
        <footer className={styles.footer}>
          <span>GRUPO POMAR</span>
          <span>Tecnologia com clareza. Relações com cuidado.</span>
          <span>
            <LockKeyhole size={12} />
            Conexão protegida
          </span>
        </footer>
      </div>
    </main>
  );
}
