import type { Task } from "@/lib/domain/model";
import { labels } from "@/lib/domain/model";
import type { DeliveryItem } from "@/lib/domain/delivery/schema";
import { isTaskClosed } from "@/lib/domain/delivery/schema";
import { fullDate } from "@/lib/domain/dates";
import type { ModalState } from "../types";
import { Badge, Button } from "../ui";
import styles from "./delivery.module.css";

export function DeliveryRow({
  task,
  item,
  today,
  open,
  context,
}: {
  task: Task;
  item: DeliveryItem;
  today: string;
  open: (modal: ModalState) => void;
  context?: string;
}) {
  const late = !isTaskClosed(task) && item.originalDueOn < today;
  return (
    <li className={styles.item}>
      <div className={styles.itemBody}>
        {context && <small>{context}</small>}
        <button
          type="button"
          className={styles.title}
          onClick={() => open({ kind: "deliveryTask", id: task.id })}
        >
          {task.title}
        </button>
        <div className="tag-row">
          <Badge
            tone={
              task.status === "done"
                ? "green"
                : task.status === "blocked" || late
                  ? "danger"
                  : task.status === "waiting_client" || task.status === "review"
                    ? "amber"
                    : "neutral"
            }
          >
            {labels.task[task.status]}
          </Badge>
          {late && <Badge tone="danger">Prazo original vencido</Badge>}
          {item.required && (
            <span className={styles.required}>Obrigatória</span>
          )}
        </div>
        {!isTaskClosed(task) &&
          item.nextAction &&
          item.nextAction !== task.title && <p>{item.nextAction}</p>}
        {item.dependency && (
          <p className={styles.dependency}>{item.dependency}</p>
        )}
        <small>
          Prazo {fullDate(task.dueOn)}
          {task.dueOn !== item.originalDueOn &&
            ` · Original ${fullDate(item.originalDueOn)}`}
          {item.phase === "recurring" &&
            ` · ${item.completedQuantity}/${item.targetQuantity} realizadas`}
        </small>
      </div>
      <Button onClick={() => open({ kind: "deliveryTask", id: task.id })}>
        {isTaskClosed(task) ? "Consultar" : "Executar"}
      </Button>
    </li>
  );
}
