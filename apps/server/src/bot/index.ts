import "./commands";
import "./flows";
import { bot } from "./instance";
import { COMMANDS } from "./commands";

export { bot } from "./instance";
export type { Ctx } from "./instance";
export { COMMANDS } from "./commands";

/** Update types Telegram should deliver to our webhook. */
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

/** Shown on Telegram's "What can this bot do?" screen before /start. */
const BOT_DESCRIPTION =
  "Welcome to P.R.I.M.E copy trade bot, Copy from your favourite traders with ease.";
/** Short blurb shown on the bot's profile / share card. */
const BOT_SHORT_DESCRIPTION = "Copy your favourite traders with ease.";

function isLocalHostname(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return true;
  }
}

/**
 * Publish the command menu and the "What can this bot do?" description. These
 * are chat/profile settings, independent of how updates are delivered.
 */
export async function syncBotProfile(): Promise<void> {
  await bot.api.setMyCommands(COMMANDS);
  await bot.api.setMyDescription(BOT_DESCRIPTION);
  await bot.api.setMyShortDescription(BOT_SHORT_DESCRIPTION);
}

/**
 * Point Telegram at this server's webhook. Returns the registered URL, or null
 * when skipped (no PUBLIC_BASE_URL, or a local URL Telegram can't reach).
 * Idempotent — safe to call on every boot.
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
  return url;
}

/**
 * Load the bot identity, sync the profile, and (re)register the webhook. Called
 * on server boot so deployments don't depend on someone remembering to run the
 * set-webhook script. Never throws: the server should still come up (and serve
 * /health) if Telegram is briefly unreachable.
 */
export async function initBot(): Promise<void> {
  await bot.init();
  try {
    await syncBotProfile();
    const url = await registerWebhook();
    if (url) console.log(`[bot] webhook registered at ${url}`);
  } catch (e) {
    console.error("[bot] bot setup failed", e);
  }
}
