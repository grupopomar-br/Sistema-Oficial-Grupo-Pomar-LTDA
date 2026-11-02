import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseNotificationConfig } from "../config/notifications";
import { camelize } from "../domain/transport";
import { databaseFailure } from "./workspace";
import {
  emptyNotifications,
  notificationListSchema,
} from "../notifications/contracts";
export async function readNotifications(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("pomar_notifications_list");
  if (error?.code === "PGRST202") return { ...emptyNotifications };
  if (error) throw databaseFailure(error);
  let pushConfigured = false,
    publicKey = "";
  try {
    const c = parseNotificationConfig(process.env);
    if (c.enabled) {
      pushConfigured = true;
      publicKey = c.publicKey;
    }
  } catch {}
  return notificationListSchema.parse({
    ...(camelize(data) as object),
    pushConfigured,
    publicKey,
  });
}
