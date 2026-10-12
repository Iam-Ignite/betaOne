import { webhookCallback } from "grammy";
import { bot } from "../bot";

// The secret token is echoed back by Telegram on every update; grammY verifies it.
export const telegramWebhook = webhookCallback(bot, "express", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});
