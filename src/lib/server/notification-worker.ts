import "server-only";
import postgres from "postgres";
import webpush from "web-push";

import { deliveriesSchema, deliverBatch } from "../notifications/delivery";
import type { NotificationConfig } from "../config/notifications";
let pool: { key: string; sql: ReturnType<typeof postgres> } | undefined;
function database(config: NotificationConfig) {
  const key = config.databaseUrl + "\n" + (config.databaseCa ?? "");
  if (pool?.key !== key) {
    if (pool) void pool.sql.end({ timeout: 5 });
    pool = {
      key,
      sql: postgres(config.databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 20,
        max_lifetime: 300,
        ssl: {
          rejectUnauthorized: true,
          ...(config.databaseCa ? { ca: config.databaseCa } : {}),
        },
        onnotice: () => {},
      }),
    };
  }
  return pool.sql;
}
export async function dispatchNotifications(config: NotificationConfig) {
  const sql = database(config);
  const rows = await sql`select public.pomar_notifications_claim(10) jobs`;
  const jobs = deliveriesSchema.parse(rows[0]?.jobs);
  return deliverBatch(jobs, {
    valid: async (job) =>
      (
        await sql`select public.pomar_notification_delivery_valid(${job.id}::uuid,${job.lease}::uuid) valid`
      )[0]?.valid === true,
    send: (job, message, ttl) =>
      webpush.sendNotification(job.subscription, JSON.stringify(message), {
        vapidDetails: {
          subject: config.appUrl,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: ttl,
        timeout: 5000,
        urgency: job.kind === "meeting" ? "high" : "normal",
      }),
    ack: async (job, outcome) => {
      await sql`select public.pomar_notification_ack(${job.id}::uuid,${job.lease}::uuid,${outcome})`;
    },
  });
}
