import { z } from "zod";

export const avatarPathSchema = z.union([
  z.literal(""),
  z.literal("brand"),
  z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/),
]);
export const profileSchema = z.strictObject({
  avatarPath: avatarPathSchema,
  version: z.number().int().min(0),
});
export const methodologySchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(2).max(160),
  service: z.string().trim().max(120),
  purpose: z.string().trim().max(3000),
  steps: z.string().trim().max(20000),
  differentiators: z.string().trim().max(8000),
  deliverables: z.string().trim().max(8000),
  qualityCriteria: z.string().trim().max(8000),
  notes: z.string().trim().max(10000),
  archived: z.boolean(),
});
export type Methodology = z.infer<typeof methodologySchema>;
export const personalizationCommands = [
  z.strictObject({
    type: z.literal("saveMethodology"),
    value: methodologySchema,
  }),
  z.strictObject({
    type: z.literal("saveProfile"),
    avatarPath: avatarPathSchema,
    expectedVersion: z.number().int().min(0),
  }),
] as const;
