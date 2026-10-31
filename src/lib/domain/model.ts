import {
  ideaSchema,
  collectionAgreementSchema,
  collectionActionSchema,
  chargeSchema,
  providerPaymentSchema,
  refundSchema,
  extensionCommands,
} from "./extensions.ts";
import { newId } from "./id.ts";
import { z } from "zod";
import { isDateOnly } from "./dates.ts";

const id = z.uuid();
const text = (max = 250) => z.string().trim().max(max);
const title = text(160).min(2, "Informe pelo menos dois caracteres.");
const date = z.string().refine(isDateOnly, "Data inválida.");
const timestamp = z.iso.datetime({ offset: true });
const cents = z.number().int().min(0).max(100_000_000_000);
const base = {
  id,
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const clientSchema = z.strictObject({
  ...base,
  name: title,
  kind: z.enum(["business", "person"]),
  city: text(100),
  segment: text(100),
  contactName: text(100),
  email: z.union([z.email(), z.literal("")]),
  phone: text(40),
  website: z.union([
    z
      .url()
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "Use um endereço http ou https.",
      ),
    z.literal(""),
  ]),
  notes: text(5000),
  status: z.enum(["active", "prospect", "archived"]),
});
export const areaSchema = z.strictObject({
  ...base,
  name: title,
  color: z.enum(["green", "amber", "violet", "blue"]),
  archived: z.boolean(),
});
export const projectSchema = z
  .strictObject({
    ...base,
    name: title,
    clientId: id.nullable(),
    contractorId: id.nullable(),
    areaId: id,
    status: z.enum([
      "planning",
      "active",
      "waiting",
      "paused",
      "completed",
      "cancelled",
    ]),
    priority: prioritySchema,
    startedOn: date.nullable(),
    dueOn: date.nullable(),
    nextAction: text(1000),
    nextActionOn: date.nullable(),
    waitingFor: text(500),
    notes: text(10000),
  })
  .refine(
    (value) =>
      !value.startedOn || !value.dueOn || value.dueOn >= value.startedOn,
    "A entrega deve ocorrer após o início.",
  );
export const taskSchema = z.strictObject({
  ...base,
  title,
  projectId: id.nullable(),
  priority: prioritySchema,
  status: z.enum(["pending", "doing", "blocked", "done"]),
  dueOn: date.nullable(),
  focusOn: date.nullable(),
  description: text(5000),
  completedAt: timestamp.nullable(),
});
export const contractSchema = z.strictObject({
  ...base,
  title,
  clientId: id,
  projectId: id.nullable(),
  totalCents: cents.positive(),
  signedOn: date,
  status: z.enum(["active", "cancelled", "completed"]),
  notes: text(5000),
});
export const installmentSchema = z.strictObject({
  ...base,
  contractId: id,
  sequence: z.number().int().min(1).max(120),
  dueOn: date,
  amountCents: cents.positive(),
  status: z.enum(["open", "cancelled"]),
});
export const receiptSchema = z.strictObject({
  ...base,
  contractId: id,
  amountCents: cents.positive(),
  receivedOn: date.nullable(),
  status: z.enum(["confirmed", "voided"]),
  voidReason: text(1000),
});
export const allocationSchema = z.strictObject({
  ...base,
  receiptId: id,
  installmentId: id,
  amountCents: cents.positive(),
});
export const expenseSchema = z
  .strictObject({
    ...base,
    title,
    category: z.enum(["infrastructure", "service", "withdrawal", "other"]),
    projectId: id.nullable(),
    amountCents: cents.positive(),
    dueOn: date.nullable(),
    paidOn: date.nullable(),
    status: z.enum(["pending", "paid", "cancelled"]),
    notes: text(5000),
  })
  .refine(
    (value) => value.status !== "paid" || !!value.paidOn,
    "Informe quando a despesa foi paga.",
  );
export const opportunitySchema = z.strictObject({
  ...base,
  title,
  clientId: id,
  stage: z.enum([
    "identified",
    "contact",
    "diagnosis",
    "proposal",
    "negotiation",
    "won",
    "lost",
  ]),
  valueCents: cents,
  nextAction: text(1000),
  nextContactOn: date.nullable(),
  notes: text(5000),
  lostReason: text(1000),
  projectId: id.nullable(),
});
export const updateSchema = z.strictObject({
  ...base,
  projectId: id,
  message: text(5000).min(3),
});
export const auditSchema = z.strictObject({
  id,
  entityType: z.string().max(40),
  entityId: id,
  action: z.string().max(60),
  summary: z.string().max(500),
  createdAt: timestamp,
});
export const settingsSchema = z.strictObject({
  businessName: title,
  displayName: text(60).min(1),
  dailyFocusLimit: z.number().int().min(1).max(5),
  staleDays: z.number().int().min(3).max(90),
});

export const workspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(0),
  settings: settingsSchema,
  clients: z.array(clientSchema).max(10000),
  areas: z.array(areaSchema).max(100),
  projects: z.array(projectSchema).max(10000),
  tasks: z.array(taskSchema).max(20000),
  contracts: z.array(contractSchema).max(10000),
  installments: z.array(installmentSchema).max(20000),
  receipts: z.array(receiptSchema).max(20000),
  allocations: z.array(allocationSchema).max(20000),
  expenses: z.array(expenseSchema).max(10000),
  opportunities: z.array(opportunitySchema).max(10000),
  updates: z.array(updateSchema).max(20000),
  ideas: z.array(ideaSchema).max(10000).default([]),
  collectionAgreements: z
    .array(collectionAgreementSchema)
    .max(10000)
    .default([]),
  collectionActions: z.array(collectionActionSchema).max(20000).default([]),
  charges: z.array(chargeSchema).max(20000).default([]),
  providerPayments: z.array(providerPaymentSchema).max(20000).default([]),
  refunds: z.array(refundSchema).max(20000).default([]),
  history: z.array(auditSchema).max(1000),
  processedCommands: z.array(id).max(500),
});
export const commandSchema = z.discriminatedUnion("type", [
  ...extensionCommands,
  z.strictObject({ type: z.literal("saveClient"), value: clientSchema }),
  z.strictObject({ type: z.literal("saveArea"), value: areaSchema }),
  z.strictObject({ type: z.literal("saveProject"), value: projectSchema }),
  z.strictObject({ type: z.literal("saveTask"), value: taskSchema }),
  z.strictObject({ type: z.literal("saveExpense"), value: expenseSchema }),
  z.strictObject({
    type: z.literal("saveOpportunity"),
    value: opportunitySchema,
  }),
  z.strictObject({
    type: z.literal("saveSettings"),
    value: settingsSchema,
    expectedRevision: z.number().int().min(0),
  }),
  z.strictObject({
    type: z.literal("setTaskStatus"),
    id,
    status: taskSchema.shape.status,
    expectedVersion: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("createContract"),
    value: contractSchema,
    count: z.number().int().min(1).max(120),
    firstDueOn: date,
  }),
  z.strictObject({
    type: z.literal("postReceipt"),
    installmentId: id,
    amountCents: cents.positive(),
    receivedOn: date.nullable(),
  }),
  z.strictObject({ type: z.literal("dateReceipt"), id, receivedOn: date }),
  z.strictObject({
    type: z.literal("voidReceipt"),
    id,
    reason: text(1000).min(5),
  }),
  z.strictObject({
    type: z.literal("cancelContract"),
    id,
    reason: text(1000).min(5),
  }),
  z.strictObject({
    type: z.literal("addUpdate"),
    projectId: id,
    message: text(5000).min(3),
  }),
  z.strictObject({
    type: z.literal("convertOpportunity"),
    id,
    projectId: id,
    areaId: id,
    dueOn: date.nullable(),
  }),
]);
export const envelopeSchema = z.strictObject({
  commandId: id,
  command: commandSchema,
});

export type Client = z.infer<typeof clientSchema>;
export type Area = z.infer<typeof areaSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type Installment = z.infer<typeof installmentSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type AuditEntry = z.infer<typeof auditSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type Priority = z.infer<typeof prioritySchema>;

export function newBase(now = new Date().toISOString()) {
  return { id: newId(), version: 1, createdAt: now, updatedAt: now };
}

export function emptyWorkspace(now = new Date().toISOString()): Workspace {
  return {
    schemaVersion: 1,
    revision: 0,
    settings: {
      businessName: "Grupo Pomar",
      displayName: "William",
      dailyFocusLimit: 5,
      staleDays: 7,
    },
    clients: [],
    projects: [],
    tasks: [],
    contracts: [],
    installments: [],
    receipts: [],
    allocations: [],
    expenses: [],
    opportunities: [],
    updates: [],
    ideas: [],
    collectionAgreements: [],
    collectionActions: [],
    charges: [],
    providerPayments: [],
    refunds: [],
    history: [],
    processedCommands: [],
    areas: [
      {
        ...newBase(now),
        name: "Operação direta",
        color: "green",
        archived: false,
      },
      { ...newBase(now), name: "Parcerias", color: "amber", archived: false },
      {
        ...newBase(now),
        name: "Estratégicos",
        color: "violet",
        archived: false,
      },
    ],
  };
}

export const labels = {
  project: {
    planning: "Planejamento",
    active: "Em execução",
    waiting: "Aguardando",
    paused: "Pausado",
    completed: "Concluído",
    cancelled: "Cancelado",
  },
  task: {
    pending: "A fazer",
    doing: "Em andamento",
    blocked: "Bloqueada",
    done: "Concluída",
  },
  client: { active: "Ativo", prospect: "Em negociação", archived: "Arquivado" },
  stage: {
    identified: "Identificada",
    contact: "Contato iniciado",
    diagnosis: "Diagnóstico",
    proposal: "Proposta",
    negotiation: "Negociação",
    won: "Ganha",
    lost: "Perdida",
  },
  expense: { pending: "A pagar", paid: "Paga", cancelled: "Cancelada" },
  category: {
    infrastructure: "Infraestrutura",
    service: "Serviço",
    withdrawal: "Retirada",
    other: "Outros",
  },
} as const;
