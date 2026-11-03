import { z } from "zod";
import { subscriptionSchema, pushMessage } from "./contracts.ts";
export const deliveriesSchema = z
  .array(
    z.strictObject({
      id: z.uuid(),
      lease: z.uuid(),
      kind: z.enum(["sale", "meeting", "test"]),
      sourceId: z.uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
      subscription: subscriptionSchema,
      amountCents: z
        .number()
        .int()
        .positive()
        .max(100_000_000_000)
        .nullable()
        .optional(),
      meetingStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    }),
  )
  .max(50);
export type Delivery = z.infer<typeof deliveriesSchema>[number];
export type DeliveryOutcome = "sent" | "retry" | "gone" | "failed";
export async function deliverBatch(
  jobs: Delivery[],
  actions: {
    valid: (job: Delivery) => Promise<boolean>;
    send: (
      job: Delivery,
      message: ReturnType<typeof pushMessage>,
      ttl: number,
    ) => Promise<unknown>;
    ack: (job: Delivery, outcome: DeliveryOutcome) => Promise<void>;
  },
  now = Date.now(),
) {
  const outcomes = await Promise.all(
    jobs.map(async (job) => {
      let outcome: DeliveryOutcome = "failed";
      if (
        !(job.kind === "sale" && job.amountCents === null) &&
        (await actions.valid(job))
      ) {
        const seconds = Math.floor((Date.parse(job.expiresAt) - now) / 1000);
        if (seconds > 0) {
          try {
            await actions.send(
              job,
              pushMessage(job.kind, job.sourceId, job),
              Math.min(3600, seconds),
            );
            outcome = "sent";
          } catch (error) {
            const status =
              error && typeof error === "object" && "statusCode" in error
                ? Number(error.statusCode)
                : 0;
            outcome = [404, 410].includes(status)
              ? "gone"
              : status >= 400 && status < 500 && status !== 429
                ? "failed"
                : "retry";
          }
        }
      }
      await actions.ack(job, outcome);
      return outcome;
    }),
  );
  return {
    claimed: jobs.length,
    sent: outcomes.filter((o) => o === "sent").length,
    retry: outcomes.filter((o) => o === "retry").length,
    failed: outcomes.filter((o) => o === "failed" || o === "gone").length,
  };
}
