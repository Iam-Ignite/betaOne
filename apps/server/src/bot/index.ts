import "./commands";
import "./flows";
import { lookup } from "node:dns/promises";
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

let unresolvableWarnedFor: string | null = null;

async function isResolvableHostname(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);
    await lookup(hostname);
    return true;
  } catch {
    return false;
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
  if (!(await isResolvableHostname(base))) {
    if (unresolvableWarnedFor !== base) {
      unresolvableWarnedFor = base;
      console.warn(
        `[bot] PUBLIC_BASE_URL host does not resolve (${base}) — skipping webhook registration`,
      );
    }
    return null;
  }
  const url = `${base.replace(/\/+$/, "")}/telegram`;
  await bot.api.setWebhook(url, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ALLOWED_UPDATES,
  });
  return url;
}

/** Retry a boot-time Telegram call — a single transient failure must not leave
 * the bot deaf (no webhook) until the next manual restart. */
async function retry(label: string, fn: () => Promise<unknown>, attempts = 4): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      console.error(`[bot] ${label} failed (attempt ${i}/${attempts})`, e);
      if (i < attempts) await new Promise((r) => setTimeout(r, i * 3_000));
    }
  }
  console.error(`[bot] ${label} gave up after ${attempts} attempts`);
}

function expectedWebhookUrl(): string | null {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base || isLocalHostname(base)) return null;
  return `${base.replace(/\/+$/, "")}/telegram`;
}

/** Warn at most once — the watchdog interval re-runs this check continuously. */
let missingBaseWarned = false;

/**
 * Idempotent self-healing check: if Telegram isn't pointing at our webhook (or
 * pointed at a stale one), fix it. Called on boot and on an interval so a
 * cleared/failed registration can't silently mute the bot until the next deploy.
 */
export async function ensureWebhook(): Promise<void> {
  const expected = expectedWebhookUrl();
  if (!expected) {
    if (!missingBaseWarned) {
      missingBaseWarned = true;
      console.warn("[bot] PUBLIC_BASE_URL missing or local — cannot register webhook");
    }
    return;
  }
  try {
    const info = await bot.api.getWebhookInfo();
    if (info.url === expected && !info.last_error_message) return;
    console.warn(
      `[bot] webhook mismatch — have "${info.url}", want "${expected}"` +
        (info.last_error_message ? ` (last error: ${info.last_error_message})` : ""),
    );
    const url = await registerWebhook();
    if (url) {
      console.log(`[bot] webhook re-registered at ${url} (${info.pending_update_count} queued)`);
      await retry("syncBotProfile", syncBotProfile, 2);
    }
  } catch (e) {
    console.error("[bot] webhook check failed", e);
  }
}

/**
 * Load the bot identity and (re)register the webhook. Profile sync is
 * deliberately last and independent: a setMyCommands/setMyDescription failure
 * must never prevent webhook registration, or the bot goes silent entirely.
 * Never throws — the server should still come up (and serve /health) if
 * Telegram is briefly unreachable.
 */
export async function initBot(): Promise<void> {
  await retry("bot.init", () => bot.init(), 3);
  await ensureWebhook();
  await retry("syncBotProfile", syncBotProfile, 2);
}
