import { bot } from "../src/bot/index";
import { COMMANDS } from "../src/bot/commands";

async function main() {
  // PUBLIC_BASE_URL must be the public URL of THIS server (e.g. the Render URL).
  const base = process.env.PUBLIC_BASE_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base) throw new Error("PUBLIC_BASE_URL is required");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");

  await bot.api.setWebhook(`${base}/telegram`, {
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  await bot.api.setMyCommands(COMMANDS); // gives you the menu shown in Telegram
  console.log("webhook + commands set");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
