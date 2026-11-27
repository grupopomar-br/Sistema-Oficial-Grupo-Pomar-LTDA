import type { Workspace } from "../model.ts";
import { isTaskClosed } from "./schema.ts";
import {
  contractPeriods,
  recurrenceDue,
  deliveryAssert as assert,
} from "./operations.ts";

export function validateDeliveryRelations(state: Workspace) {
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  const plans = new Map(state.deliveryPlans.map((p) => [p.id, p]));
  const itemIds = new Set(state.deliveryItems.map((i) => i.id));
  const itemsByPlan = new Map<string, Workspace["deliveryItems"]>();
  for (const item of state.deliveryItems) {
    const items = itemsByPlan.get(item.planId) ?? [];
    items.push(item);
    itemsByPlan.set(item.planId, items);
  }
  const evidenceItems = new Set(
    state.deliveryEvidence.map((evidence) => evidence.itemId),
  );
  const keys = new Set<string>();
  for (const playbook of state.servicePlaybooks) {
    const identity = `${playbook.key}:${playbook.version}`;
    assert(!keys.has(identity), "A versão do modelo está duplicada.");
    keys.add(identity);
    const steps = new Map(playbook.steps.map((s) => [s.key, s]));
    assert(
      steps.size === playbook.steps.length,
      "O modelo contém etapas duplicadas.",
    );
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (key: string) => {
      assert(!visiting.has(key), "O modelo contém dependências circulares.");
      if (visited.has(key)) return;
      const step = steps.get(key);
      assert(step, "Uma dependência do modelo não existe.");
      visiting.add(key);
      for (const parent of step.dependsOn) visit(parent);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of steps.keys()) visit(key);
  }
  keys.clear();
  for (const plan of state.deliveryPlans) {
    assert(
      state.projects.some((p) => p.id === plan.projectId) &&
        state.contracts.some(
          (c) => c.id === plan.contractId && c.projectId === plan.projectId,
        ),
      "Plano possui projeto ou contrato incompatível.",
    );
    assert(
      !plan.methodologyId ||
        state.methodologies.some((m) => m.id === plan.methodologyId),
      "A metodologia de referência do plano não existe.",
    );
    assert(
      state.servicePlaybooks.some(
        (p) => p.key === plan.playbookKey && p.version === plan.playbookVersion,
      ),
      "A versão do modelo do plano não existe.",
    );
    contractPeriods(plan.startsOn, plan.endsOn);
    const playbook = state.servicePlaybooks.find(
      (p) => p.key === plan.playbookKey && p.version === plan.playbookVersion,
    )!;
    const implementation = (itemsByPlan.get(plan.id) ?? []).filter(
      (item) => item.phase === "implementation",
    );
    assert(
      implementation.length === playbook.steps.length,
      "O plano possui etapas ausentes ou adicionais.",
    );
    for (const step of playbook.steps) {
      const item = implementation.find((item) => item.stepKey === step.key);
      assert(
        item &&
          item.required === step.required &&
          item.critical === step.critical &&
          item.weight === step.weight &&
          item.finalReview === step.finalReview &&
          JSON.stringify(item.criteria) === JSON.stringify(step.criteria) &&
          JSON.stringify(item.dependsOn) === JSON.stringify(step.dependsOn),
        "Os critérios da implantação divergem da versão aplicada.",
      );
    }
    const periods = new Map(
      contractPeriods(plan.startsOn, plan.endsOn).map((period) => [
        period.start,
        period,
      ]),
    );
    const rules = new Map(plan.recurrenceRules.map((rule) => [rule.key, rule]));
    assert(
      rules.size === plan.recurrenceRules.length,
      "A programação contém regras duplicadas.",
    );
    for (const item of (itemsByPlan.get(plan.id) ?? []).filter(
      (item) => item.phase === "recurring",
    )) {
      const rule = rules.get(item.stepKey);
      const period = item.periodStart && periods.get(item.periodStart);
      assert(
        rule &&
          period &&
          item.periodEnd === period.end &&
          item.targetQuantity === rule.targetQuantity &&
          item.originalDueOn === recurrenceDue(period, rule) &&
          JSON.stringify(item.criteria) === JSON.stringify(rule.criteria),
        "A obrigação diverge da programação contratual confirmada.",
      );
    }
    assert(
      plan.implementationDueOn >= plan.startsOn &&
        plan.implementationDueOn <= plan.endsOn,
      "O prazo de implantação está fora da vigência.",
    );
    const key = `${plan.projectId}:${plan.playbookKey}`;
    if (plan.status !== "archived") {
      assert(
        !keys.has(key),
        "Há planos ativos duplicados para a mesma metodologia.",
      );
      keys.add(key);
    }
  }
  keys.clear();
  for (const item of state.deliveryItems) {
    const plan = plans.get(item.planId),
      task = tasks.get(item.id);
    assert(
      plan && task && task.projectId === plan.projectId,
      "Entrega possui plano ou tarefa incompatível.",
    );
    const key = `${plan.id}:${item.stepKey}:${item.periodStart ?? "implementation"}`;
    assert(!keys.has(key), "A obrigação já existe nesta competência.");
    keys.add(key);
    assert(
      item.completedQuantity <= item.targetQuantity &&
        new Set(item.acceptedCriteria).size === item.acceptedCriteria.length &&
        item.acceptedCriteria.every((c) => item.criteria.includes(c)),
      "A entrega possui quantidades ou critérios inconsistentes.",
    );
    assert(
      (task.status === "done") === (item.validatedAt !== null),
      "A validação da entrega está inconsistente.",
    );
    if (task.status === "not_applicable")
      assert(
        !item.required &&
          item.reason.length >= 5 &&
          item.completedQuantity === 0,
        "A dispensa da entrega não está justificada.",
      );
    if (task.status === "done")
      assert(
        item.completedQuantity === item.targetQuantity &&
          item.acceptedCriteria.length === item.criteria.length &&
          evidenceItems.has(item.id),
        "A entrega concluída possui critérios ou evidências pendentes.",
      );
    if (item.phase === "recurring")
      assert(
        item.periodStart &&
          item.periodEnd &&
          item.periodStart >= plan.startsOn &&
          item.periodEnd <= plan.endsOn &&
          item.periodEnd >= item.periodStart,
        "A competência da entrega está fora da vigência.",
      );
    else
      assert(
        item.periodStart === null && item.periodEnd === null,
        "A implantação contém uma competência indevida.",
      );
  }
  for (const task of state.tasks)
    if (!itemIds.has(task.id))
      assert(
        ["pending", "doing", "blocked", "done"].includes(task.status),
        "Esse estado exige uma tarefa vinculada a um plano de entrega.",
      );
  for (const evidence of state.deliveryEvidence)
    assert(itemIds.has(evidence.itemId), "A evidência está sem entrega.");
  for (const event of state.deliveryEvents)
    assert(
      plans.has(event.planId) &&
        (!event.itemId ||
          state.deliveryItems.some(
            (i) => i.id === event.itemId && i.planId === event.planId,
          )),
      "O histórico contém uma entrega inexistente.",
    );
  for (const item of state.deliveryItems) {
    if (
      tasks.get(item.id)?.status !== "done" ||
      item.phase !== "implementation"
    )
      continue;
    const dependencies = (itemsByPlan.get(item.planId) ?? []).filter(
      (i) =>
        i.planId === item.planId &&
        i.id !== item.id &&
        i.phase === "implementation" &&
        (item.finalReview || item.dependsOn.includes(i.stepKey)),
    );
    assert(
      dependencies.every((i) => isTaskClosed(tasks.get(i.id)!)),
      "A entrega concluída possui dependências abertas.",
    );
  }
}
