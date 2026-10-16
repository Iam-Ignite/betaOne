import express from "express";
import cors from "cors";
import { startLoops } from "./worker/loops";
import { initBot, ensureWebhook } from "./bot";
import { telegramWebhook } from "./routes/telegram";
import { heliusRouter } from "./routes/helius";
import { miniRouter } from "./routes/mini";
import { adminRouter } from "./routes/admin";
import { healthRouter } from "./routes/health";

export const app = express();

// CORS: only the frontend origin(s) may call from a browser (the Telegram mini
// app loads from the web_app URL's origin). Admin calls are server-to-server.
const origins = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: origins.length ? origins : "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.type("text/plain").send("ok");
});

// Health / metrics (no auth — for uptime monitors, Prometheus).
app.use(healthRouter);

// Telegram updates (grammY webhook; secret token verified by the adapter).
app.post("/telegram", telegramWebhook);

// Helius enhanced webhook (trader activity → pending copy orders).
app.use(heliusRouter);

// Telegram Mini App data.
app.use(miniRouter);

// Admin API (basic auth enforced by the router).
app.use(adminRouter);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`server listening on :${port}`));

// Register the Telegram webhook on boot (idempotent) so we don't depend on a
// manual `set-webhook` run after each deploy. Failures are logged, not fatal.
initBot().catch((e) => console.error("[bot] init failed", e));

// Watchdog: re-assert the webhook if Telegram's copy is missing or stale. A
// lost registration once silenced the bot until a redeploy; this self-heals
// within one interval. Set WEBHOOK_WATCH_MS=0 to disable.
const webhookWatchMs = Number(process.env.WEBHOOK_WATCH_MS ?? 5 * 60 * 1000);
if (webhookWatchMs > 0) {
  setInterval(() => {
    ensureWebhook().catch((e) => console.error("[bot] webhook watch failed", e));
  }, webhookWatchMs);
  console.log(`webhook watchdog every ${webhookWatchMs / 1000}s`);
}

startLoops();

// Self keep-alive: a free host (e.g. Render) spins the service down after 15
// minutes with no inbound traffic. RENDER_EXTERNAL_URL is the public URL, so
// fetching it counts as inbound and resets the idle timer. This only prevents
// sleep — it can't wake an already-slept service, so an external uptime monitor
// is still the reliable option. Set WORKER_KEEPALIVE_MS=0 to disable.
const selfUrl = process.env.RENDER_EXTERNAL_URL;
const keepaliveMs = Number(process.env.WORKER_KEEPALIVE_MS ?? 10 * 60 * 1000);
if (selfUrl && keepaliveMs > 0) {
  setInterval(() => {
    fetch(`${selfUrl}/health`).catch((e) => console.error("keepalive ping failed", e));
  }, keepaliveMs);
  console.log(`keep-alive pinging ${selfUrl}/health every ${keepaliveMs / 1000}s`);
}
