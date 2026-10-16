import "./commands";
import "./flows";
import { bot } from "./instance";
import { COMMANDS } from "./commands";

export { bot } from "./instance";
export type { Ctx } from "./instance";
export { COMMANDS } from "./commands";

/** Update types Telegram should deliver to our webhook. */
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

function isLocalHostname(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return true;
  }
}

/**
 * Point Telegram at this server's webhook and publish the command menu.
 * Returns the registered URL, or null when skipped (no PUBLIC_BASE_URL, or a
 * local URL Telegram can't reach). Idempotent — safe to call on every boot.
 */
export async function registerWebhook(): Promise<string | null> {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    console.warn("[bot] PUBLIC_BASE_URL is not set — skipping webhook registration");
    return null;
  }
  if (isLocalHostname(base)) {
    console.warn(
      `[bot] PUBLIC_BASE_URL is local (${base}) — Telegram can't reach it, skipping webhook registration`,
    );
    return null;
  }
  const url = `${base.replace(/\/+$/, "")}/telegram`;
  await bot.api.setWebhook(url, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ALLOWED_UPDATES,
  });
  await bot.api.setMyCommands(COMMANDS);
  return url;
}

/**
 * Load the bot identity and (re)register the webhook. Called on server boot so
 * deployments don't depend on someone remembering to run the set-webhook script.
 * Never throws: the server should still come up (and serve /health) if Telegram
 * is briefly unreachable.
 */
export async function initBot(): Promise<void> {
  await bot.init();
  try {
    const url = await registerWebhook();
    if (url) console.log(`[bot] webhook registered at ${url}`);
  } catch (e) {
    console.error("[bot] webhook registration failed", e);
  }
}
