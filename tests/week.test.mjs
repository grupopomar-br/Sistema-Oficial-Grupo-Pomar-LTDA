import { test } from "node:test";
import assert from "node:assert/strict";
import { weekPlan, weekStart } from "../src/lib/domain/week.ts";

test("o planejamento abre a próxima semana no fim de semana e separa foco, prazos e horários locais", () => {
  const monday = "2026-11-09";
  assert.equal(weekStart("2026-11-08", true), monday);
  assert.equal(weekStart("2026-11-07"), "2026-11-02");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  const task = {
    id: "task",
    title: "Tarefa fictícia",
    focusOn: "2026-11-10",
    dueOn: "2026-11-12",
    priority: "P2",
    status: "pending",
  };
  const dateOnly = { ...task, id: "due-only", focusOn: null, dueOn: monday };
  const commitment = {
    id: "meeting",
    startsAt: "2026-11-10T01:30:00Z",
    status: "scheduled",
  };
  const result = weekPlan(
    {
      tasks: [
        task,
        dateOnly,
        { ...task, id: "unplanned", dueOn: null, focusOn: null },
      ],
      projects: [
        { id: "delivery", dueOn: "2026-11-15", status: "active" },
        { id: "finished", dueOn: monday, status: "completed" },
      ],
      meetings: [
        commitment,
        { ...commitment, id: "cancelled", status: "cancelled" },
      ],
    },
    monday,
  );
  assert.equal(result.length, 7);
  assert.deepEqual(result[0].meetings, [
    { meeting: commitment, time: "22:30" },
  ]);
  assert.deepEqual(result[0].tasks, [dateOnly]);
  assert.deepEqual(result[1].tasks, [task]);
  assert.deepEqual(result[3].deadlines, [task]);
  assert.equal(result[0].projects.length, 0);
  assert.equal(result[6].projects[0].id, "delivery");
});
