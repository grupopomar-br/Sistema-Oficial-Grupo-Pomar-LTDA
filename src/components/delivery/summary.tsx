import type { Workspace } from "@/lib/domain/model";
import {
  deliveryProgress,
  recurrencePeriods,
} from "@/lib/domain/delivery/selectors";
import { ProjectMeter } from "../project-meter";
import styles from "./delivery.module.css";

export function DeliverySummary({
  state,
  planId,
  today,
}: {
  state: Workspace;
  planId: string;
  today: string;
}) {
  const implementation = deliveryProgress(
    state,
    state.deliveryItems.filter(
      (i) => i.planId === planId && i.phase === "implementation",
    ),
  );
  const periods = recurrencePeriods(state, planId);
  const current = periods.find((p) => p.start <= today && p.end >= today);
  const accumulated = deliveryProgress(
    state,
    periods.filter((p) => p.start <= today).flatMap((p) => p.items),
  );
  return (
    <div className={styles.summary}>
      <div>
        <ProjectMeter
          label="Implantação validada"
          percent={implementation.percent ?? 0}
        />
        <small>
          {implementation.completed} de {implementation.total} entregas
          aplicáveis · {implementation.excluded} dispensadas
        </small>
      </div>
      <div>
        {current ? (
          <>
            <ProjectMeter
              label="Recorrência da competência atual"
              percent={current.progress.percent ?? 0}
            />
            <small>
              {current.progress.validatedQuantity} de{" "}
              {current.progress.quantity} unidades validadas
              {" · "}
              {current.progress.reportedQuantity} realizadas
            </small>
          </>
        ) : (
          <>
            <strong>Recorrência contratual</strong>
            <p>
              {periods.length
                ? "Vigência fora da competência atual."
                : "Aguardando programação do escopo."}
            </p>
          </>
        )}
        {!!periods.length && (
          <small>
            {accumulated.completed} de {accumulated.total} obrigações validadas
            nas competências iniciadas · {accumulated.onTime} no prazo original
          </small>
        )}
      </div>
    </div>
  );
}
