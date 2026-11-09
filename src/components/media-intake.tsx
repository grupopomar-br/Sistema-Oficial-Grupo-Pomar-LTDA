"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CloudUpload,
  FileImage,
  LockKeyhole,
  X,
} from "lucide-react";
import {
  mediaAccept,
  mediaSize,
  mediaTokenPattern,
  metadataForFile,
  type MediaMetadata,
  type MediaRequest,
} from "@/lib/media/contracts";
import { fullDate } from "@/lib/domain/dates";
import { newId } from "@/lib/domain/id";
import { BrandLogo } from "./brand-logo";
import { Button, IconButton } from "./ui";
import styles from "./media-intake.module.css";

type Upload = {
  id: string;
  file: File;
  metadata: MediaMetadata;
  progress: number;
  state: "queued" | "sending" | "checking" | "received" | "error";
  error?: string;
};

const selectionLimit = 20;
const introKey = "pomar-vip-intro-v1";

async function requestMedia(input: MediaRequest, signal?: AbortSignal) {
  const response = await fetch("/api/envio-vip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
    credentials: "omit",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Envio indisponível.");
  return data;
}

function sendToStorage(
  ticket: { url: string; headers: Record<string, string> },
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.url);
    for (const [name, value] of Object.entries(ticket.headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.floor((100 * event.loaded) / event.total));
    };
    request.onload = () => {
      if (
        (request.status >= 200 && request.status < 300) ||
        request.status === 412
      )
        resolve();
      else
        reject(new Error("O armazenamento recusou o envio. Tente novamente."));
    };
    request.onerror = request.onabort = () =>
      reject(
        new Error(
          "O envio foi interrompido. Confira a conexão e tente novamente.",
        ),
      );
    request.send(file);
  });
}

const statusLabels = {
  queued: "Na fila",
  sending: "Enviando",
  checking: "Conferindo arquivo",
  received: "Recebido",
  error: "Envio pendente",
} as const;

export default function MediaIntake({
  storageOrigin,
}: {
  storageOrigin: string;
}) {
  const [access, setAccess] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [status, setStatus] = useState("Conferindo o convite…");
  const [files, setFiles] = useState<Upload[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const introDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!mediaTokenPattern.test(token)) {
      setStatus("Abra o link de envio recebido do Grupo Pomar.");
      return;
    }
    const controller = new AbortController();
    const intro = introDialog.current;
    let introTimer: number | undefined;
    void requestMedia({ action: "status", token }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setAccess({ token, expiresAt: data.expiresAt });
        if (
          !intro?.showModal ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return;
        try {
          if (window.sessionStorage.getItem(introKey)) return;
          window.sessionStorage.setItem(introKey, "1");
        } catch {}
        intro.showModal();
        introTimer = window.setTimeout(() => intro.close(), 5000);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setStatus(
            failure instanceof Error
              ? failure.message
              : "Convite indisponível.",
          );
      });
    return () => {
      controller.abort();
      window.clearTimeout(introTimer);
      intro?.close();
    };
  }, []);

  const pending = files.filter((file) => file.state !== "received");
  const update = (id: string, patch: Partial<Upload>) =>
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...patch } : file)),
    );

  const select = (list: FileList | null) => {
    if (!list?.length || sending) return;
    setError("");
    if (list.length + pending.length > selectionLimit) {
      setError(`Selecione até ${selectionLimit} arquivos por vez.`);
      return;
    }
    const accepted: Upload[] = [];
    for (const file of Array.from(list)) {
      try {
        accepted.push({
          id: newId(),
          file,
          metadata: metadataForFile(file),
          progress: 0,
          state: "queued",
        });
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Arquivo incompatível.",
        );
      }
    }
    setFiles((current) => [...current, ...accepted]);
  };

  const send = async () => {
    if (!access || sending || !pending.length) return;
    const { token } = access;
    setSending(true);
    setError("");
    const queue = [...pending];
    const sendFromQueue = async () => {
      for (;;) {
        const upload = queue.shift();
        if (!upload) return;
        const { id, metadata } = upload;
        update(id, { progress: 0, state: "sending", error: undefined });
        try {
          const ticket = await requestMedia({
            action: "reserve",
            token,
            id,
            file: metadata,
          });
          if (ticket.received !== true) {
            await sendToStorage(ticket, upload.file, (progress) =>
              update(id, { progress }),
            );
            update(id, { progress: 100, state: "checking" });
            await requestMedia({ action: "confirm", token, id });
          }
          update(id, { progress: 100, state: "received" });
        } catch (failure) {
          update(id, {
            state: "error",
            error:
              failure instanceof Error ? failure.message : "Tente novamente.",
          });
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, pending.length) }, sendFromQueue),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={styles.page}>
      {access && storageOrigin ? (
        <link rel="preconnect" href={storageOrigin} crossOrigin="anonymous" />
      ) : null}
      <div className={styles.wrap}>
        <header className={styles.header}>
          <BrandLogo className={styles.wordmark} eager />
          <span className={styles.privateLabel}>
            <LockKeyhole size={15} aria-hidden="true" /> Área VIP
          </span>
        </header>
        <div className={styles.layout}>
          <section className={styles.hero} aria-labelledby="media-title">
            <p className={styles.eyebrow}>MÍDIAS DO PROJETO</p>
            <h1 id="media-title">
              Envie suas
              <br />
              <span>fotos e vídeos.</span>
            </h1>
            <p className={styles.description}>
              Selecione os originais que vamos usar no seu projeto.
            </p>
          </section>
          <section className={styles.card} aria-labelledby="media-upload-title">
            <header className={styles.cardHeader}>
              <span className={styles.cardIcon} aria-hidden="true">
                <CloudUpload size={22} />
              </span>
              <div>
                <h2 id="media-upload-title">Envio de arquivos</h2>
                <p>
                  {access
                    ? `Convite válido até ${fullDate(access.expiresAt)}.`
                    : "Acesso exclusivo por convite."}
                </p>
              </div>
            </header>
            {access ? (
              <>
                <label className={styles.chooser}>
                  <span>Selecionar arquivos</span>
                  <small>Até {selectionLimit} arquivos por vez</small>
                  <input
                    type="file"
                    accept={mediaAccept}
                    multiple
                    disabled={sending}
                    aria-label="Selecionar arquivos"
                    aria-describedby="media-formats"
                    onChange={(event) => {
                      select(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p id="media-formats" className={styles.note}>
                  PNG, JPG, HEIC, HEIF e WebP até 30 MB por imagem.
                  <br />
                  MP4, MOV e WebM até 500 MB por vídeo.
                </p>
                {files.length > 0 && (
                  <ul className={styles.files}>
                    {files.map((file) => (
                      <li key={file.id}>
                        {file.state === "received" ? (
                          <Check size={17} aria-hidden="true" />
                        ) : (
                          <FileImage size={17} aria-hidden="true" />
                        )}
                        <div>
                          <strong>{file.metadata.fileName}</strong>
                          <small>
                            {mediaSize(file.metadata.sizeBytes)} ·{" "}
                            {statusLabels[file.state]}
                          </small>
                          {["sending", "checking"].includes(file.state) && (
                            <progress
                              max={100}
                              value={file.progress}
                              aria-label={`Envio de ${file.metadata.fileName}`}
                            />
                          )}
                          {file.error && (
                            <p className="form-error" role="alert">
                              {file.error}
                            </p>
                          )}
                        </div>
                        {file.state !== "received" && (
                          <IconButton
                            label={`Remover ${file.metadata.fileName} da seleção`}
                            disabled={sending}
                            onClick={() =>
                              setFiles((current) =>
                                current.filter((item) => item.id !== file.id),
                              )
                            }
                          >
                            <X size={16} />
                          </IconButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  className={styles.send}
                  variant="primary"
                  disabled={sending || !pending.length}
                  onClick={() => void send()}
                >
                  <CloudUpload size={16} aria-hidden="true" />
                  {sending
                    ? "Enviando mídias…"
                    : pending.some((file) => file.state === "error")
                      ? "Tentar envios pendentes"
                      : "Enviar mídias"}
                </Button>
                {files.length > 0 && !pending.length && (
                  <p className={styles.received} role="status">
                    <Check size={16} aria-hidden="true" />
                    Todos os arquivos desta seleção foram recebidos.
                  </p>
                )}
              </>
            ) : (
              <p className={styles.status} role="status">
                {status}
              </p>
            )}
          </section>
        </div>
      </div>
      <dialog
        ref={introDialog}
        className={styles.welcome}
        aria-labelledby="media-welcome-title"
      >
        <div className={styles.welcomeContent}>
          <BrandLogo className={styles.welcomeLogo} theme="dark" />
          <h2 id="media-welcome-title">
            Seu projeto <em>começa aqui.</em>
          </h2>
          <div className={styles.welcomeProgress} aria-hidden="true" />
          <button
            type="button"
            className={styles.skipWelcome}
            onClick={() => introDialog.current?.close()}
          >
            Pular abertura <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </dialog>
    </main>
  );
}
