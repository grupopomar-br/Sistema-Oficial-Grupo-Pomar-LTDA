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
  Loader2,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { PixCheckout } from "@/lib/billing/pix-contract";
import { money } from "@/lib/domain/dates";
import styles from "./payment-checkout.module.css";

function PaymentBrand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <svg width="30" height="34" viewBox="0 0 29 32" fill="none">
          <path
            d="M14.5 2 26 8.6v14L14.5 30 3 23V9L14.5 2Z"
            stroke="currentColor"
            strokeWidth="2.3"
          />
          <path
            d="M10 23V11.5l5-3 5 3v6l-5 3v-5l3-2"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        <strong>GRUPO POMAR</strong>
        <small>Pagamentos</small>
      </span>
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
  preview = false,
}: {
  initial: PixCheckout | null;
  token?: string;
  preview?: boolean;
}) {
  const [checkout, setCheckout] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const locked = useRef(false);
  const code = useRef<HTMLTextAreaElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
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
    if (preview || checkout?.status !== "pending") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void request({ action: "refresh" }, true);
    }, 25000);
    return () => clearInterval(timer);
  }, [checkout?.status, preview, request]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  const seconds =
    checkout && now
      ? Math.max(
          0,
          Math.floor((new Date(checkout.expiresAt).valueOf() - now) / 1000),
        )
      : null;
  const expired =
    checkout?.status === "expired" ||
    (seconds === 0 && ["ready", "pending"].includes(checkout?.status ?? ""));
  const status = expired ? "expired" : checkout?.status;
  const paid = status === "paid";
  const unavailable = !checkout;
  const terminal =
    paid || ["closed", "expired", "review"].includes(status ?? "");
  const countdown =
    seconds === null
      ? "Conferindo validade"
      : seconds >= 3600
        ? `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}min`
        : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

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
                  <span className={styles.pill}>Pix</span>
                </div>
                <h2>{checkout.description}</h2>
                <p className={styles.reference}>
                  Referência {checkout.reference}
                </p>
                <div className={styles.total}>
                  <span>Valor do pagamento</span>
                  <strong>{money(checkout.amountCents)}</strong>
                  <small>Valor definido na sua cobrança.</small>
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
                <strong>Do seu banco, direto para o pagamento.</strong>
                <span>
                  O Pix é processado pelo Mercado Pago. A confirmação aparece
                  aqui após a verificação.
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
                Seus dados
              </span>
              <b />
              <span
                className={
                  status === "pending"
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
                  <QrCode size={26} />
                </span>
                <div>
                  <h2 id="pix-title">
                    {paid ? "Tudo certo por aqui." : "Pague com Pix"}
                  </h2>
                  <p>Simples, direto e pelo seu banco.</p>
                </div>
              </div>

              {unavailable ? (
                <div className={styles.state} role="status">
                  <span className={styles.stateIcon}>
                    <LockKeyhole size={30} />
                  </span>
                  <h3>Este link não está disponível.</h3>
                  <p>
                    Confira o endereço recebido ou solicite um novo link ao
                    Grupo Pomar.
                  </p>
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
                        <span>Conferindo o QR Code…</span>
                      </div>
                    )}
                  </div>
                  <span className={styles.timer}>
                    <Clock3 size={14} />
                    Válido por {countdown}
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
              Como pagar usando o mesmo celular?
              <ChevronDown size={16} />
            </summary>
            <p>
              Toque em Copiar código Pix, abra o aplicativo do seu banco e
              escolha Pix Copia e Cola. Cole o código, confira os dados e
              confirme no banco.
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
