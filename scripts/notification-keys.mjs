import webpush from "web-push";
import { randomBytes } from "node:crypto";
// Run locally on the owner's computer. Never commit or share this output.
const keys = webpush.generateVAPIDKeys();
console.log(
  JSON.stringify(
    {
      POMAR_NOTIFICATIONS_ENABLED: "true",
      POMAR_VAPID_PUBLIC_KEY: keys.publicKey,
      POMAR_VAPID_PRIVATE_KEY: keys.privateKey,
      POMAR_NOTIFICATIONS_CRON_SECRET: randomBytes(32).toString("base64url"),
    },
    null,
    2,
  ),
);
