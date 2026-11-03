"use client";
import { useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCheck,
  Download,
  ExternalLink,
  Eye,
  MousePointer2,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Route,
} from "lucide-react";
import { newBase } from "@/lib/domain/model";
import { fullDate, shiftMonth } from "@/lib/domain/dates";
import { toCsv } from "@/lib/domain/backup";
import {
  comparablePeriods,
  googleMetrics,
  googleNumber,
  googleProfileKey,
  metricChange,
  periodDays,
  previousGoogleResult,
  type GoogleResult,
} from "@/lib/domain/google-results";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, Field, Modal } from "../ui";
import type { ViewProps } from "../types";
import styles from "./google-results.module.css";

const icons = [MousePointer2, Phone, CalendarDays, Route, ExternalLink, Eye];
const period = (row: GoogleResult) =>
  `${fullDate(row.periodStart)} a ${fullDate(row.periodEnd)}`;
function blank(
  clientId: string,
  today: string,
  profileName = "",
): GoogleResult {
  const periodStart = `${shiftMonth(today.slice(0, 7), -1)}-01`;
  const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCDate(0);
  return {
    ...newBase(),
    clientId,
    profileName,
    profileUrl: "",
    periodStart,
    periodEnd: date.toISOString().slice(0, 10),
    collectedOn: today,
    interactions: null,
    calls: null,
    bookings: null,
    directions: null,
    websiteClicks: null,
    profileViews: null,
    notes: "",
    verified: false,
    archived: false,
  };
}
export default function GoogleResults({ today, navigate }: ViewProps) {
  const { state, execute, saving, operationError, clearOperationError } =
    useWorkspace();
  const [clientSelection, setClientSelection] = useState("");
  const [profileSelection, setProfileSelection] = useState("");
  const [reportSelection, setReportSelection] = useState("");
  const [baselineSelection, setBaselineSelection] = useState("");
  const [drafts, setDrafts] = useState(false);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<GoogleResult | null>(null);
  const clientId =
    clientSelection ||
    state.googleResults.find((r) => !r.archived)?.clientId ||
    state.clients[0]?.id ||
    "";
  const client = state.clients.find((c) => c.id === clientId);
  const clientRows = useMemo(
    () =>
      state.googleResults.filter(
        (r) =>
          r.clientId === clientId &&
          r.archived === archived &&
          (drafts || r.verified),
      ),
    [state.googleResults, clientId, drafts, archived],
  );
  const profiles = useMemo(
    () => [
      ...new Map(
        clientRows.map((r) => [googleProfileKey(r), r.profileName]),
      ).entries(),
    ],
    [clientRows],
  );
  const profileKey = profiles.some(([key]) => key === profileSelection)
    ? profileSelection
    : profiles[0]?.[0] || "";
  const rows = useMemo(
    () =>
      clientRows
        .filter((r) => googleProfileKey(r) === profileKey)
        .toSorted(
          (a, b) =>
            b.periodEnd.localeCompare(a.periodEnd) ||
            b.createdAt.localeCompare(a.createdAt),
        ),
    [clientRows, profileKey],
  );
  const current = rows.find((r) => r.id === reportSelection) ?? rows[0] ?? null;
  const candidates = current
    ? rows.filter((r) => comparablePeriods(current, r))
    : [];
  const previous =
    candidates.find((r) => r.id === baselineSelection) ??
    (current ? previousGoogleResult(current, rows) : null);
  const resetSelection = () => {
    setReportSelection("");
    setBaselineSelection("");
  };
  const edit = (value: GoogleResult) => {
    clearOperationError();
    setEditing(value);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const value = {
      ...editing,
      clientId: String(form.get("clientId")),
      profileName: String(form.get("profileName")),
      profileUrl: String(form.get("profileUrl")),
      periodStart: String(form.get("periodStart")),
      periodEnd: String(form.get("periodEnd")),
      collectedOn: String(form.get("collectedOn")),
      notes: String(form.get("notes")),
      verified: form.get("verified") === "on",
      ...Object.fromEntries(
        googleMetrics.map(({ key }) => [
          key,
          String(form.get(key) ?? "").trim() === ""
            ? null
            : Number(form.get(key)),
        ]),
      ),
    } as GoogleResult;
    if (await execute({ type: "saveGoogleResult", value })) {
      setEditing(null);
      setClientSelection(value.clientId);
      setProfileSelection(googleProfileKey(value));
      setReportSelection(value.id);
      setBaselineSelection("");
      setArchived(value.archived);
      if (!value.verified) setDrafts(true);
    }
  };
  const archive = async (row: GoogleResult) => {
    clearOperationError();
    if (
      await execute({
        type: "saveGoogleResult",
        value: { ...row, archived: !row.archived },
      })
    )
      resetSelection();
  };
  const exportCsv = () => {
    if (!current) return;
    const csv = toCsv(
      [
        "Cliente",
        "Perfil",
        "Início",
        "Fim",
        "Conferido em",
        "Estado",
        ...googleMetrics.map((m) => m.description),
        "Observações",
      ],
      rows.map((r) => [
        client?.name,
        r.profileName,
        r.periodStart,
        r.periodEnd,
        r.collectedOn,
        r.verified ? "Conferido pelo proprietário" : "Rascunho",
        ...googleMetrics.map((m) => r[m.key] ?? "Não informado"),
        r.notes,
      ]),
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `resultados-google-${current.periodEnd}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={`view-stack ${styles.view}`}>
      <section className={styles.hero}>
        <div>
          <span className="eyebrow">PRESENÇA LOCAL · RESULTADOS</span>
          <h2>
            Seu trabalho merece
            <br />
            <em>resultados visíveis.</em>
          </h2>
          <p>
            Os números do Google, organizados para acompanhar a evolução de cada
            cliente.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button onClick={exportCsv} disabled={!current}>
            <Download size={16} />
            Exportar CSV
          </Button>
          <Button
            variant="primary"
            disabled={
              !state.googleResultsReady || !state.clients.length || saving
            }
            onClick={() =>
              edit({
                ...blank(
                  clientId,
                  today,
                  current?.profileName || client?.name || "",
                ),
                profileUrl: current?.profileUrl ?? "",
              })
            }
          >
            <Plus size={17} />
            Registrar período
          </Button>
        </div>
      </section>
      {!state.googleResultsReady && (
        <div className="inline-note">
          A área está aguardando a ativação na sua conta. Seus registros atuais
          continuam disponíveis.
        </div>
      )}
      <div className={styles.filters}>
        <Field label="Cliente">
          <select
            value={clientId}
            onChange={(e) => {
              setClientSelection(e.target.value);
              setProfileSelection("");
              resetSelection();
            }}
          >
            {!state.clients.length && (
              <option value="">Nenhum cliente cadastrado</option>
            )}
            {state.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Perfil / unidade">
          <select
            value={profileKey}
            onChange={(e) => {
              setProfileSelection(e.target.value);
              resetSelection();
            }}
            disabled={!profiles.length}
          >
            {!profiles.length && (
              <option value="">Nenhum período disponível</option>
            )}
            {profiles.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.toggles}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={drafts}
              onChange={(e) => {
                setDrafts(e.target.checked);
                resetSelection();
              }}
            />
            <span>Incluir rascunhos</span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                resetSelection();
              }}
            />
            <span>Ver arquivados</span>
          </label>
        </div>
      </div>
      {current ? (
        <>
          <section className={`panel ${styles.report}`}>
            <header className={styles.reportHeader}>
              <div>
                <span className="eyebrow">PERFIL DA EMPRESA NO GOOGLE</span>
                <h3>{client?.name}</h3>
                <p>{current.profileName}</p>
              </div>
              <div className={styles.reportBadges}>
                <Badge tone={current.verified ? "green" : "amber"}>
                  {current.verified
                    ? "Conferido por você"
                    : "Rascunho · não conferido"}
                </Badge>
                {current.profileUrl && (
                  <a
                    href={current.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.profileLink}
                  >
                    Abrir perfil <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </header>
            <div className={styles.periods}>
              <Field label="Período em destaque">
                <select
                  value={current.id}
                  onChange={(e) => {
                    setReportSelection(e.target.value);
                    setBaselineSelection("");
                  }}
                >
                  {rows.map((r) => (
                    <option value={r.id} key={r.id}>
                      {period(r)}
                      {r.verified ? "" : " · rascunho"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Comparar com">
                <select
                  value={previous?.id || ""}
                  disabled={!candidates.length}
                  onChange={(e) => setBaselineSelection(e.target.value)}
                >
                  {!candidates.length && (
                    <option value="">Sem período anterior comparável</option>
                  )}
                  {candidates.map((r) => (
                    <option value={r.id} key={r.id}>
                      {period(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <p className={styles.collected}>
                Dados conferidos em
                <br />
                <strong>{fullDate(current.collectedOn)}</strong>
              </p>
            </div>
            {!current.verified && (
              <p className={styles.note}>
                Este período é um rascunho. Confira os números no Google para
                habilitar a comparação.
              </p>
            )}
            {previous && periodDays(previous) !== periodDays(current) && (
              <p className={styles.note}>
                Os períodos têm durações diferentes: {periodDays(current)} dias
                no atual e {periodDays(previous)} no anterior. A variação
                compara os totais desses períodos.
              </p>
            )}
            <div className={styles.metricGrid}>
              {googleMetrics.map((metric, index) => {
                const value = current[metric.key],
                  before = previous?.[metric.key] ?? null,
                  change = previous ? metricChange(value, before) : null,
                  max = Math.max(value ?? 0, before ?? 0, 1),
                  Icon = icons[index];
                const percent = change?.percent;
                const changeLabel = change
                  ? percent === null
                    ? "Sem base percentual"
                    : `${percent! > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(percent!)}%`
                  : previous
                    ? "Sem dados para comparar"
                    : "Sem período anterior";
                return (
                  <article className={styles.metric} key={metric.key}>
                    <div className={styles.metricTop}>
                      <h4>{metric.label}</h4>
                      <Icon size={19} />
                    </div>
                    <strong
                      className={`${styles.number} ${value === null ? styles.missing : ""}`}
                    >
                      {googleNumber(value)}
                    </strong>
                    <div
                      className={`${styles.change} ${change && change.difference < 0 ? styles.decline : ""}`}
                    >
                      {change &&
                        (change.difference < 0 ? (
                          <ArrowDownRight size={16} />
                        ) : (
                          <ArrowUpRight size={16} />
                        ))}
                      <span>{changeLabel}</span>
                      {change && (
                        <small>
                          {change.difference > 0 ? "+" : ""}
                          {googleNumber(change.difference)} no período
                        </small>
                      )}
                    </div>
                    <div
                      className={styles.bars}
                      aria-label={`Atual: ${googleNumber(value)}. Anterior: ${googleNumber(before)}.`}
                    >
                      <div>
                        <span>Atual</span>
                        <i>
                          <b
                            style={{ width: `${((value ?? 0) / max) * 100}%` }}
                          />
                        </i>
                        <small>{googleNumber(value)}</small>
                      </div>
                      {previous && (
                        <div>
                          <span>Anterior</span>
                          <i>
                            <b
                              className={styles.previousBar}
                              style={{
                                width: `${((before ?? 0) / max) * 100}%`,
                              }}
                            />
                          </i>
                          <small>{googleNumber(before)}</small>
                        </div>
                      )}
                    </div>
                    <p className={styles.metricHint}>{metric.hint}</p>
                  </article>
                );
              })}
            </div>
            <footer className={styles.reportFooter}>
              <span>
                <CheckCheck size={16} /> Origem: Perfil da Empresa no Google ·
                preenchimento manual
              </span>
              <p>
                As barras comparam os números dos períodos. A variação é
                calculada sobre o valor anterior; quando ele é zero, não
                estimamos uma porcentagem. Campo vazio significa não informado.
              </p>
            </footer>
          </section>
          {current.notes && (
            <section className={`panel ${styles.context}`}>
              <h3>Contexto do período</h3>
              <p>{current.notes}</p>
            </section>
          )}
          <section className={`panel ${styles.history}`}>
            <div>
              <span className="eyebrow">EVOLUÇÃO DOCUMENTADA</span>
              <h3>Histórico deste perfil</h3>
            </div>
            <div className={styles.historyRows}>
              {rows.map((r) => (
                <article key={r.id}>
                  <button
                    type="button"
                    className={styles.periodButton}
                    onClick={() => {
                      setReportSelection(r.id);
                      setBaselineSelection("");
                    }}
                    aria-pressed={current.id === r.id}
                  >
                    <CalendarDays size={18} />
                    <span>
                      <strong>{period(r)}</strong>
                      <small>
                        {r.verified ? "Conferido por você" : "Rascunho"} ·{" "}
                        {periodDays(r)} dias
                      </small>
                    </span>
                  </button>
                  <div className={styles.rowActions}>
                    <Button disabled={saving} onClick={() => edit(r)}>
                      <Pencil size={14} />
                      Editar
                    </Button>
                    <Button disabled={saving} onClick={() => void archive(r)}>
                      {r.archived ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Archive size={14} />
                      )}
                      <span>{r.archived ? "Restaurar" : "Arquivar"}</span>
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          icon={BarChart3}
          title={
            !state.clients.length
              ? "Comece cadastrando o cliente."
              : "A evolução começa com o primeiro período."
          }
          description={
            !state.clients.length
              ? "Vincule os resultados ao cliente para manter o histórico organizado."
              : drafts || archived
                ? "Nenhum registro corresponde aos filtros escolhidos."
                : "Abra a performance do perfil no Google, escolha o período e registre os números exatamente como aparecem."
          }
          action={!state.clients.length ? "Ir para clientes" : undefined}
          onAction={() => navigate("clients")}
        />
      )}
      <p className={styles.sourceNote}>
        Somente métricas disponíveis no perfil devem ser preenchidas. Não
        somamos visualizações ou interações de relatórios diferentes.{" "}
        <a
          href="https://support.google.com/business/answer/9918094?hl=pt-BR"
          target="_blank"
          rel="noopener noreferrer"
        >
          Entenda as métricas do Google <ExternalLink size={12} />
        </a>
      </p>
      {operationError && !editing && (
        <p role="alert" className="form-error">
          {operationError}
        </p>
      )}
      {editing && (
        <Modal
          title={
            state.googleResults.some((r) => r.id === editing.id)
              ? "Editar período do Google"
              : "Registrar resultados do Google"
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={(event) => void save(event)} className="entity-form">
            <div className="form-grid">
              <Field label="Cliente">
                <select
                  name="clientId"
                  defaultValue={editing.clientId}
                  required
                >
                  {state.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Nome do perfil / unidade"
                hint="Use o mesmo nome para manter os períodos no mesmo histórico."
              >
                <input
                  name="profileName"
                  defaultValue={editing.profileName}
                  required
                  minLength={2}
                  maxLength={160}
                />
              </Field>
              <Field label="Link do perfil no Google (opcional)" wide>
                <input
                  name="profileUrl"
                  defaultValue={editing.profileUrl}
                  type="url"
                  placeholder="https://..."
                  maxLength={2048}
                />
              </Field>
              <Field label="Início do período">
                <input
                  name="periodStart"
                  type="date"
                  defaultValue={editing.periodStart}
                  max={today}
                  required
                />
              </Field>
              <Field label="Fim do período">
                <input
                  name="periodEnd"
                  type="date"
                  defaultValue={editing.periodEnd}
                  max={today}
                  required
                />
              </Field>
              <Field label="Data da conferência">
                <input
                  name="collectedOn"
                  type="date"
                  defaultValue={editing.collectedOn}
                  max={today}
                  required
                />
              </Field>
            </div>
            <p className={styles.formIntro}>
              Copie os totais do período no Google. Se uma métrica não aparecer,
              deixe em branco; preencha 0 somente quando o Google informar zero.
            </p>
            <div className="form-grid">
              {googleMetrics.map((metric) => (
                <Field
                  key={metric.key}
                  label={metric.description}
                  hint={metric.hint}
                >
                  <input
                    name={metric.key}
                    type="number"
                    min={0}
                    max={1000000000}
                    step={1}
                    inputMode="numeric"
                    defaultValue={editing[metric.key] ?? ""}
                    placeholder="Não informado"
                  />
                </Field>
              ))}
              <Field label="Contexto e observações (opcional)" wide>
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={editing.notes}
                  placeholder="Mudanças de horário, campanhas, sazonalidade ou observações do relatório."
                />
              </Field>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="verified"
                defaultChecked={editing.verified}
              />
              <span>
                Conferi estes números no relatório do Google para o período
                acima.
              </span>
            </label>
            <p className={styles.formIntro}>
              Sem essa confirmação, o registro fica como rascunho. Você pode
              editar e conferir depois.
            </p>
            {operationError && (
              <p className="form-error" role="alert">
                {operationError}
              </p>
            )}
            <div className="modal-actions">
              <Button onClick={() => setEditing(null)}>Cancelar</Button>
              <Button variant="primary" type="submit" disabled={saving}>
                <CheckCheck size={16} />
                {saving ? "Salvando..." : "Salvar período"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
