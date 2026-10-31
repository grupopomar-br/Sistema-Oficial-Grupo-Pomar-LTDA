"use client";
import { useMemo, useState } from "react";
import { ArrowRight, Plus, TrendingUp, Calendar } from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Button, EmptyState, SearchInput, StatCard } from "../ui";
import type { ViewProps } from "../types";
import { labels, type Opportunity } from "@/lib/domain/model";
import { money, shortDate } from "@/lib/domain/dates";

export default function Commercial({
  open,
  navigate,
  today,
  hiddenValues,
}: ViewProps) {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("open");
  const all = useMemo(
    () =>
      state.opportunities.filter((item) =>
        `${item.title} ${state.clients.find((client) => client.id === item.clientId)?.name ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [state, query],
  );
  const openItems = all.filter((item) => !["won", "lost"].includes(item.stage));
  const stages: Opportunity["stage"][] =
    scope === "open"
      ? ["identified", "contact", "diagnosis", "proposal", "negotiation"]
      : ["won", "lost"];
  const format = (value: number) => (hiddenValues ? "••••" : money(value));
  return (
    <div className="view-stack">
      <div className="view-intro">
        <div>
          <h2>Relacionamento que avança.</h2>
          <p>Cada conversa com contexto, etapa e próximo passo.</p>
        </div>
        <Button
          variant="primary"
          disabled={!state.clients.length}
          title={
            !state.clients.length ? "Cadastre uma empresa primeiro" : undefined
          }
          onClick={() => open({ kind: "opportunity" })}
        >
          <Plus size={17} />
          Oportunidade
        </Button>
      </div>
      <div className="stats-grid three">
        <StatCard
          title="Oportunidades em aberto"
          value={openItems.length}
          detail="Conversas em andamento"
          icon={TrendingUp}
        />
        <StatCard
          title="Valor estimado em negociação"
          value={format(
            openItems.reduce((sum, item) => sum + item.valueCents, 0),
          )}
          detail="Estimativa comercial · não é caixa"
        />
        <StatCard
          title="Acompanhamentos previstos"
          value={
            openItems.filter(
              (item) => item.nextContactOn && item.nextContactOn <= today,
            ).length
          }
          detail="Contatos para hoje ou vencidos"
          icon={Calendar}
          accent
        />
      </div>
      <div className="panel filter-main">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar oportunidade ou empresa"
        />
        <div className="segmented">
          <button
            type="button"
            className={scope === "open" ? "selected" : ""}
            onClick={() => setScope("open")}
          >
            Em andamento
          </button>
          <button
            type="button"
            className={scope === "closed" ? "selected" : ""}
            onClick={() => setScope("closed")}
          >
            Encerradas
          </button>
        </div>
      </div>
      {state.opportunities.length ? (
        <div
          className={`pipeline ${scope === "closed" ? "pipeline-closed" : ""}`}
        >
          {stages.map((stage) => {
            const items = all.filter((item) => item.stage === stage);
            return (
              <section className="pipeline-column" key={stage}>
                <div className="pipeline-heading">
                  <span className={`pipeline-dot stage-${stage}`} />
                  <h3>{labels.stage[stage]}</h3>
                  <span>{items.length}</span>
                </div>
                <div className="pipeline-value">
                  {format(
                    items.reduce((sum, item) => sum + item.valueCents, 0),
                  )}
                </div>
                {items.map((item) => (
                  <article className="opportunity-card" key={item.id}>
                    <button
                      type="button"
                      className="opportunity-title"
                      onClick={() => open({ kind: "opportunity", id: item.id })}
                    >
                      {item.title}
                    </button>
                    <p>
                      {
                        state.clients.find(
                          (client) => client.id === item.clientId,
                        )?.name
                      }
                    </p>
                    <strong>{format(item.valueCents)}</strong>
                    <div className="opportunity-next">
                      {item.nextAction || "Definir próxima ação."}
                    </div>
                    <div className="opportunity-footer">
                      <span
                        className={
                          item.nextContactOn &&
                          item.nextContactOn <= today &&
                          scope === "open"
                            ? "text-amber"
                            : ""
                        }
                      >
                        <Calendar size={12} />
                        {shortDate(item.nextContactOn)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          open({ kind: "opportunity", id: item.id })
                        }
                      >
                        Editar
                      </button>
                    </div>
                    {!item.projectId && item.stage !== "lost" && (
                      <Button
                        className="full-width"
                        onClick={() => open({ kind: "convert", id: item.id })}
                      >
                        Criar projeto
                        <ArrowRight size={13} />
                      </Button>
                    )}
                    {item.projectId && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          open({ kind: "projectDetail", id: item.projectId! })
                        }
                      >
                        Abrir projeto
                        <ArrowRight size={13} />
                      </Button>
                    )}
                  </article>
                ))}
                {!items.length && (
                  <div className="pipeline-empty">Nenhuma oportunidade</div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={TrendingUp}
            title="Organize a próxima conversa."
            description="Cadastre a empresa e acompanhe cada oportunidade até o fechamento."
            action={
              state.clients.length ? "Criar oportunidade" : "Cadastrar empresa"
            }
            onAction={() =>
              state.clients.length
                ? open({ kind: "opportunity" })
                : navigate("clients")
            }
          />
        </div>
      )}
    </div>
  );
}
