import { db, notifyAdmin, notify } from "@copytrade/core";
import { processCopyOrder, refundBuy } from "./copy-orders";
import { checkDeposits } from "./deposits";
import { syncHeliusAddresses } from "./helius-sync";
import { rotateTradingCoin, generateSubscriberTradingStatus, getTradingStatusKeyboard } from "../bot/trading-status";

async function claim(table: "CopyOrder" | "Withdrawal", limit: number): Promise<string[]> {
  const model = table === "CopyOrder" ? db.copyOrder : db.withdrawal;
  const rows = await model.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const ids = rows.map((r: any) => r.id);
  if (ids.length > 0) {
    await model.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
  }
  return ids;
}

async function tick() {
  for (const id of await claim("CopyOrder", 10)) {
    processCopyOrder(id).catch((e) => console.error("order", id, e));
  }
  // Withdrawals are admin-only: they stay PENDING until an operator marks them
  // paid (or rejects them) from the admin panel. The server never signs them.
}

/**
 * Send trading status updates to all active subscribers every 3 hours.
 * Subscribers are users with a paid plan (non-OMEGA) or active copy trades.
 */
async function sendTradingUpdates() {
  try {
    // Rotate to a new coin
    const newCoin = await rotateTradingCoin();
    console.log(`[TradingUpdates] Rotated to new coin: ${newCoin.ticker}`);

    // Find all users who should receive updates:
    // 1. Users with paid plans (non-OMEGA) that haven't expired
    // 2. Users with active copy trades (paper or live)
    const now = Date.now();
    const paidUsers = await db.user.findMany({
      where: {
        status: "ACTIVE",
        planType: { not: "OMEGA" },
        OR: [
          { planEndDate: null }, // lifetime (shouldn't happen for paid)
          { planEndDate: { gt: new Date(now) } },
        ],
      },
      select: { id: true, telegramId: true },
    });

    const usersWithActiveCopies = await db.follow.findMany({
      where: { active: true },
      select: { userId: true },
    });

    // Combine and deduplicate user IDs
    const subscriberIds = new Set([
      ...paidUsers.map((u) => u.id),
      ...usersWithActiveCopies.map((f) => f.userId),
    ]);

    console.log(`[TradingUpdates] Sending to ${subscriberIds.size} subscribers`);

    // Send updates to each subscriber
    for (const userId of subscriberIds) {
      try {
        const user = paidUsers.find((u) => u.id === userId);
        if (!user) continue; // User might only have copy trades but no paid plan

        const statusText = await generateSubscriberTradingStatus(userId);
        await notify(user.telegramId, statusText, getTradingStatusKeyboard(true));
      } catch (e) {
        console.error(`[TradingUpdates] Failed to send to user ${userId}:`, e);
      }
    }
  } catch (e) {
    console.error("[TradingUpdates] Loop error:", e);
  }
}

/**
 * Crash recovery: rows stuck in PROCESSING/SUBMITTED are never blindly retried.
 * If a txSignature exists, leave it for reconciliation; otherwise fail open
 * (a human decides) so we never buy twice.
 */
async function recoverStuck() {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const stuck = await db.copyOrder.findMany({
    where: { status: "PROCESSING", txSignature: null, createdAt: { lt: cutoff } },
    include: { follow: true },
  });
  // A live buy reserves cash before it ever reaches the chain; if it crashed in
  // that window nothing was broadcast, so give the reserved SOL back.
  for (const o of stuck) {
    const followUserId = (o as any).follow?.userId;
    if (!o.paper && o.side === "BUY" && followUserId) {
      await refundBuy(o.id, followUserId);
    }
  }
  if (stuck.length) {
    await db.copyOrder.updateMany({
      where: { id: { in: stuck.map((o) => o.id) }, status: "PROCESSING" },
      data: { status: "FAILED", error: "stuck in PROCESSING without signature" },
    });
  }
  await db.withdrawal.updateMany({
    where: { status: "PROCESSING", txSignature: null, createdAt: { lt: cutoff } },
    data: { status: "FAILED", error: "stuck in PROCESSING without signature" },
  });
}

/** Start all recurring background loops. Call once on boot. */
export function startLoops() {
  const tickMs = Number(process.env.WORKER_TICK_MS ?? 500);
  const depositMs = Number(process.env.WORKER_DEPOSIT_MS ?? 20_000);
  const heliusSyncMs = Number(process.env.WORKER_HELIUS_SYNC_MS ?? 30_000);
  const tradingUpdateMs = Number(process.env.WORKER_TRADING_UPDATE_MS ?? 3 * 60 * 60 * 1000); // 3 hours

  setInterval(() => tick().catch(console.error), tickMs);
  setInterval(() => checkDeposits().catch(console.error), depositMs);
  setInterval(() => syncHeliusAddresses().catch(console.error), heliusSyncMs);
  setInterval(() => recoverStuck().catch(console.error), 60_000);
  setInterval(() => sendTradingUpdates().catch(console.error), tradingUpdateMs);

  process.on("unhandledRejection", (e) => {
    console.error("unhandledRejection", e);
    notifyAdmin(`⚠️ server unhandledRejection: ${String(e).slice(0, 300)}`);
  });

  console.log("background loops started");
}
