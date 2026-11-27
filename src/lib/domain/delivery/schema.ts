import { z } from "zod";
import { isDateOnly } from "../dates.ts";

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const day = z.string().refine(isDateOnly, "Informe uma data válida.");
const timestamp = z.iso.datetime({ offset: true });
export const taskStatuses = [
  "pending",
  "doing",
  "waiting_client",
  "blocked",
  "review",
  "done",
  "not_applicable",
] as const;
export const deliveryTaskStatus = z.enum(taskStatuses);
export const isTaskClosed = (task: { status: string }) =>
  task.status === "done" || task.status === "not_applicable";

const ruleSchema = z.strictObject({
  key: id,
  title: text(160).min(3),
  targetQuantity: z.number().int().min(1).max(1000),
  criteria: z.array(text(500).min(3)).min(1).max(10),
  dueOffset: z.number().int().min(0).max(30).nullable(),
});
export const playbookStepSchema = z.strictObject({
  key: text(80).min(1),
  groupKey: text(80).min(1),
  groupTitle: text(120).min(3),
  title: text(160).min(3),
  criteria: z.array(text(500).min(3)).min(1).max(10),
  required: z.boolean(),
  critical: z.boolean(),
  weight: z.number().int().min(1).max(10),
  dependsOn: z.array(text(80).min(1)).max(80),
  finalReview: z.boolean(),
});
export const servicePlaybookSchema = z.strictObject({
  key: text(80).min(1),
  version: z.number().int().positive(),
  title: text(160).min(3),
  family: z.enum(["google", "website", "commerce", "systems"]),
  reviewedOn: day,
  sources: z.array(z.url()).min(1).max(20),
  steps: z.array(playbookStepSchema).min(1).max(80),
});
export const deliveryPlanSchema = z.strictObject({
  id,
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  projectId: id,
  contractId: id,
  methodologyId: id.nullable(),
  playbookKey: text(80).min(1),
  playbookVersion: z.number().int().positive(),
  scopeReference: text(3000).min(5),
  startsOn: day,
  endsOn: day,
  implementationDueOn: day,
  status: z.enum(["active", "paused", "archived"]),
  recurrenceRules: z.array(ruleSchema).max(20),
});
export const deliveryItemSchema = z.strictObject({
  id,
  planId: id,
  phase: z.enum(["implementation", "recurring"]),
  stepKey: text(80).min(1),
  groupKey: text(80).min(1),
  groupTitle: text(120).min(3),
  criteria: z.array(text(500).min(3)).min(1).max(10),
  required: z.boolean(),
  critical: z.boolean(),
  weight: z.number().int().min(1).max(10),
  dependsOn: z.array(text(80).min(1)).max(80),
  finalReview: z.boolean(),
  periodStart: day.nullable(),
  periodEnd: day.nullable(),
  targetQuantity: z.number().int().min(1).max(1000),
  completedQuantity: z.number().int().min(0).max(1000),
  acceptedCriteria: z.array(text(500).min(3)).max(10),
  nextAction: text(1000),
  dependency: text(1000),
  reason: text(2000),
  originalDueOn: day,
  validatedAt: timestamp.nullable(),
});
export function validEvidenceReference(value: string) {
  if (!/^https?:/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
const evidenceReference = text(2000).refine(
  validEvidenceReference,
  "Use HTTPS sem credenciais ou uma referência interna identificável.",
);
export const deliveryEvidenceSchema = z.strictObject({
  id,
  itemId: id,
  reference: evidenceReference.min(5),
  performedOn: day,
  quantity: z.number().int().min(0).max(1000),
  createdAt: timestamp,
});
export const deliveryEventStateSchema = z.strictObject({
  status: z.string().max(40),
  dueOn: day.nullable(),
  completedQuantity: z.number().int().min(0).max(1000),
  acceptedCriteria: z.array(text(500)).max(10),
  nextAction: text(1000),
  dependency: text(1000),
});
export const deliveryEventSchema = z.strictObject({
  id,
  planId: id,
  itemId: id.nullable(),
  operation: z.enum([
    "create",
    "schedule",
    "update",
    "validate",
    "reopen",
    "exclude",
    "status",
  ]),
  summary: text(500),
  reason: text(2000),
  beforeState: deliveryEventStateSchema.nullable(),
  afterState: deliveryEventStateSchema.nullable(),
  createdAt: timestamp,
});
export const deliveryCommands = [
  z.strictObject({
    type: z.literal("createDeliveryPlan"),
    id,
    projectId: id,
    expectedProjectVersion: z.number().int().positive(),
    contractId: id,
    expectedContractVersion: z.number().int().positive(),
    methodologyId: id.nullable(),
    playbookKey: text(80).min(1),
    playbookVersion: z.number().int().positive(),
    scopeReference: text(3000).min(5),
    startsOn: day,
    endsOn: day,
    implementationDueOn: day,
  }),
  z.strictObject({
    type: z.literal("recordDeliveryTask"),
    id,
    expectedVersion: z.number().int().positive(),
    status: deliveryTaskStatus,
    dueOn: day,
    completedQuantity: z.number().int().min(0).max(1000),
    acceptedCriteria: z.array(text(500).min(3)).max(10),
    nextAction: text(1000),
    dependency: text(1000),
    reason: text(2000),
    evidenceReference,
    performedOn: day.nullable(),
  }),
  z.strictObject({
    type: z.literal("scheduleDeliveryRecurrence"),
    planId: id,
    expectedVersion: z.number().int().positive(),
    rules: z.array(ruleSchema).min(1).max(20),
  }),
  z.strictObject({
    type: z.literal("setDeliveryPlanStatus"),
    id,
    expectedVersion: z.number().int().positive(),
    status: deliveryPlanSchema.shape.status,
    reason: text(2000).min(5),
  }),
] as const;
export type ServicePlaybook = z.infer<typeof servicePlaybookSchema>;
export type DeliveryPlan = z.infer<typeof deliveryPlanSchema>;
export type DeliveryItem = z.infer<typeof deliveryItemSchema>;
export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;
export type DeliveryCommand = z.infer<(typeof deliveryCommands)[number]>;
export type RecurrenceRule = z.infer<typeof ruleSchema>;
