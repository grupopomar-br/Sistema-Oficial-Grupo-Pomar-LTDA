"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff, Send } from "lucide-react";
import { useNotifications } from "./notification-provider";
import { meetingWhen } from "@/lib/domain/meetings";
import { Button } from "./ui";
function keyBytes(key: string) {
  const s = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
export function PushSettings() {
  const { feed } = useNotifications();
  const [supported, setSupported] = useState<boolean | null>(null),
    [subscription, setSubscription] = useState<PushSubscription | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      window.isSecureContext;
    setSupported(ok);
    if (!ok || !feed.pushConfigured) return;
    let cancelled = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => r.pushManager.getSubscription())
      .then((s) => {
        if (!cancelled) setSubscription(s);
      })
      .catch(() => {
        if (!cancelled)
          setError("Não foi possível preparar os avisos neste aparelho.");
      });
    return () => {
      cancelled = true;
    };
  }, [feed.pushConfigured]);
  const request = async (url: string, value: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error ?? "Não foi possível salvar os avisos.");
  };
  const toggle = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (subscription) {
        await request("/api/notifications/device", {
          enabled: false,
          subscription: subscription.toJSON(),
        });
        await subscription.unsubscribe();
        setSubscription(null);
        setMessage("Avisos desativados neste aparelho.");
      } else {
        if ((await Notification.requestPermission()) !== "granted")
          throw Error(
            "Permita as notificações nas configurações do navegador para ativar este aparelho.",
          );
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(feed.publicKey),
        });
        try {
          await request("/api/notifications/device", {
            enabled: true,
            subscription: sub.toJSON(),
          });
        } catch (e) {
          await sub.unsubscribe();
          throw e;
        }
        setSubscription(sub);
        setMessage("Aparelho ativado. Envie um teste para conferir a entrega.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível ativar os avisos.",
      );
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    if (!subscription) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/notifications/test", {
        endpoint: subscription.endpoint,
      });
      setMessage(
        "Teste agendado para a próxima verificação do envio. Com o agendador ativo, costuma chegar em até um minuto.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao agendar o teste.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="push-settings">
      <div>
        <h3>Avisos neste aparelho</h3>
        <p>
          Receba confirmações de pagamento e lembretes de reuniões com a Central
          fechada.
        </p>
        {!feed.pushConfigured ? (
          <p className="inline-note">
            O envio para aparelhos está aguardando a configuração do serviço.
          </p>
        ) : supported === false ? (
          <p className="inline-note">
            Este navegador ainda não oferece os avisos. No iPhone, adicione a
            Central à Tela de Início e abra por esse ícone.
          </p>
        ) : (
          <div className="button-group">
            <Button
              variant={subscription ? "secondary" : "primary"}
              disabled={busy || supported === null}
              onClick={() => void toggle()}
            >
              {subscription ? <BellOff size={16} /> : <Bell size={16} />}
              {subscription
                ? "Desativar neste aparelho"
                : "Ativar neste aparelho"}
            </Button>
            {subscription && (
              <Button disabled={busy} onClick={() => void test()}>
                <Send size={16} />
                Enviar aviso de teste
              </Button>
            )}
          </div>
        )}
        <small>
          Ative em cada aparelho que deseja usar. No iPhone, use a Central
          adicionada à Tela de Início. As permissões e a conexão do aparelho
          influenciam a entrega.
        </small>
        {feed.pushConfigured &&
          (!feed.lastDispatchAt ||
            Date.now() - Date.parse(feed.lastDispatchAt) > 180000) && (
            <p className="inline-note">
              O serviço está sem verificação recente de envio. Confira a
              configuração do agendador antes de depender dos avisos externos.
            </p>
          )}
        {feed.lastDispatchAt && (
          <small>
            Última verificação de envio: {meetingWhen(feed.lastDispatchAt)}.
          </small>
        )}
        {message && (
          <p className="inline-note" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
