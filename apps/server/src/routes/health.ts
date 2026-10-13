import { Router, type Request, type Response } from "express";
import { db, getPoolAddress, getPoolBalance, getConnection, env } from "@copytrade/core";

export const healthRouter = Router();

/**
 * Lightweight health check for uptime monitors (Render, UptimeRobot, etc.).
 * Returns 200 OK with minimal JSON — no auth, no DB queries by default.
 */
healthRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Detailed health check with dependency status.
 * Use for dashboards / alerting — requires ADMIN auth if you want to protect it.
 */
healthRouter.get("/health/detailed", async (_req: Request, res: Response) => {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkSolanaRpc(),
    checkPoolWallet(),
    checkHeliusWebhook(),
    checkWorkerLiveness(),
  ]);

  const results = checks.map((c, i) => ({
    name: ["database", "solana_rpc", "pool_wallet", "helius_webhook", "worker_liveness"][i],
    status: c.status === "fulfilled" ? "healthy" : "unhealthy",
    ...(c.status === "fulfilled" ? c.value : { error: String(c.reason) }),
  }));

  const unhealthy = results.filter((r) => r.status === "unhealthy");
  const status = unhealthy.length === 0 ? 200 : 503;

  res.status(status).json({
    status: unhealthy.length === 0 ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks: results,
  });
});

/**
 * Prometheus-compatible metrics endpoint.
 * Scrape with Prometheus or render in Grafana.
 * No auth by default — put behind firewall/IP allowlist in production.
 */
healthRouter.get("/metrics", async (_req: Request, res: Response) => {
  const lines: string[] = [];

  // Build info
  lines.push(`# HELP copytrade_build_info Build information`);
  lines.push(`# TYPE copytrade_build_info gauge`);
  lines.push(`copytrade_build_info{version="${process.env.npm_package_version ?? "unknown"}",node="${process.version}"} 1`);

  // Uptime
  lines.push(`# HELP copytrade_uptime_seconds Process uptime in seconds`);
  lines.push(`# TYPE copytrade_uptime_seconds gauge`);
  lines.push(`copytrade_uptime_seconds ${Math.floor(process.uptime())}`);

  // Memory
  const mem = process.memoryUsage();
  lines.push(`# HELP copytrade_memory_bytes Memory usage in bytes`);
  lines.push(`# TYPE copytrade_memory_bytes gauge`);
  lines.push(`copytrade_memory_bytes{type="rss"} ${mem.rss}`);
  lines.push(`copytrade_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
  lines.push(`copytrade_memory_bytes{type="heap_total"} ${mem.heapTotal}`);
  lines.push(`copytrade_memory_bytes{type="external"} ${mem.external}`);

  // Event loop lag (approx)
  const lag = await measureEventLoopLag();
  lines.push(`# HELP copytrade_event_loop_lag_ms Event loop lag in milliseconds`);
  lines.push(`# TYPE copytrade_event_loop_lag_ms gauge`);
  lines.push(`copytrade_event_loop_lag_ms ${lag.toFixed(2)}`);

  // Database
  try {
    const [userCount, followCount, pendingOrders, pendingWithdrawals, failed24h] = await Promise.all([
      db.user.count(),
      db.follow.count({ where: { active: true } }),
      db.copyOrder.count({ where: { status: "PENDING" } }),
      db.withdrawal.count({ where: { status: "PENDING" } }),
      db.copyOrder.count({
        where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 864e5) } },
      }),
    ]);

    lines.push(`# HELP copytrade_users_total Total registered users`);
    lines.push(`# TYPE copytrade_users_total gauge`);
    lines.push(`copytrade_users_total ${userCount}`);

    lines.push(`# HELP copytrade_active_follows_total Active follow relationships`);
    lines.push(`# TYPE copytrade_active_follows_total gauge`);
    lines.push(`copytrade_active_follows_total ${followCount}`);

    lines.push(`# HELP copytrade_pending_orders_total Pending copy orders`);
    lines.push(`# TYPE copytrade_pending_orders_total gauge`);
    lines.push(`copytrade_pending_orders_total ${pendingOrders}`);

    lines.push(`# HELP copytrade_pending_withdrawals_total Pending withdrawal requests`);
    lines.push(`# TYPE copytrade_pending_withdrawals_total gauge`);
    lines.push(`copytrade_pending_withdrawals_total ${pendingWithdrawals}`);

    lines.push(`# HELP copytrade_failed_orders_24h Failed orders in last 24h`);
    lines.push(`# TYPE copytrade_failed_orders_24h gauge`);
    lines.push(`copytrade_failed_orders_24h ${failed24h}`);
  } catch (e) {
    lines.push(`# HELP copytrade_db_errors_total Database query errors`);
    lines.push(`# TYPE copytrade_db_errors_total counter`);
    lines.push(`copytrade_db_errors_total 1`);
  }

  // Pool solvency
  try {
    const poolAddr = await getPoolAddress();
    if (poolAddr) {
      const poolBal = await getPoolBalance();
      const totalLiability = (await db.user.findMany({ select: { balanceSol: true } })).reduce(
        (sum, u) => sum + u.balanceSol,
        0n,
      );

      lines.push(`# HELP copytrade_pool_balance_lamports Pool wallet SOL balance`);
      lines.push(`# TYPE copytrade_pool_balance_lamports gauge`);
      lines.push(`copytrade_pool_balance_lamports ${poolBal}`);

      lines.push(`# HELP copytrade_pool_liability_lamports Total user SOL liability`);
      lines.push(`# TYPE copytrade_pool_liability_lamports gauge`);
      lines.push(`copytrade_pool_liability_lamports ${totalLiability}`);

      lines.push(`# HELP copytrade_pool_solvency_ratio Pool balance / liability`);
      lines.push(`# TYPE copytrade_pool_solvency_ratio gauge`);
      lines.push(
        `copytrade_pool_solvency_ratio ${totalLiability > 0n ? Number(poolBal) / Number(totalLiability) : 1}`,
      );
    }
  } catch {
    // Pool not configured or RPC error
  }

  // Worker config
  lines.push(`# HELP copytrade_worker_tick_ms Worker tick interval`);
  lines.push(`# TYPE copytrade_worker_tick_ms gauge`);
  lines.push(`copytrade_worker_tick_ms ${Number(process.env.WORKER_TICK_MS ?? 500)}`);

  lines.push(`# HELP copytrade_trading_enabled Trading enabled flag`);
  lines.push(`# TYPE copytrade_trading_enabled gauge`);
  lines.push(`copytrade_trading_enabled ${env.TRADING_ENABLED === "true" ? 1 : 0}`);

  lines.push(`# HELP copytrade_live_trading_allowed Live trading allowed flag`);
  lines.push(`# TYPE copytrade_live_trading_allowed gauge`);
  lines.push(`copytrade_live_trading_allowed ${env.LIVE_TRADING_ALLOWED === "true" ? 1 : 0}`);

  lines.push(`# HELP copytrade_simulate_trading Simulation mode flag`);
  lines.push(`# TYPE copytrade_simulate_trading gauge`);
  lines.push(`copytrade_simulate_trading ${env.SIMULATE_TRADING === "true" ? 1 : 0}`);

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
});

async function checkDatabase(): Promise<{ latency_ms: number }> {
  const start = Date.now();
  await db.$queryRaw`SELECT 1`;
  return { latency_ms: Date.now() - start };
}

async function checkSolanaRpc(): Promise<{ latency_ms: number; slot: number }> {
  const conn = getConnection();
  const start = Date.now();
  const slot = await conn.getSlot();
  return { latency_ms: Date.now() - start, slot };
}

async function checkPoolWallet(): Promise<{ configured: boolean; balance_sol?: string }> {
  const addr = await getPoolAddress();
  if (!addr) return { configured: false };
  const bal = await getPoolBalance();
  return { configured: true, balance_sol: (Number(bal) / 1e9).toFixed(4) };
}

async function checkHeliusWebhook(): Promise<{ configured: boolean; webhook_id?: string }> {
  const id = env.HELIUS_WEBHOOK_ID;
  if (!id) return { configured: false };
  // Could ping Helius API to verify webhook is active
  return { configured: true, webhook_id: id };
}

async function checkWorkerLiveness(): Promise<{ last_tick_age_ms: number }> {
  // Check if worker has processed anything recently
  const recent = await db.copyOrder.findFirst({
    where: { status: { in: ["CONFIRMED", "FAILED", "SKIPPED"] } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  const lastTickAge = recent ? Date.now() - recent.updatedAt.getTime() : -1;
  return { last_tick_age_ms: lastTickAge };
}

function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6;
      resolve(lag);
    });
  });
}