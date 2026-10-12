import { db, notifyAdmin } from "@copytrade/core";
import { processCopyOrder, refundBuy } from "./copy-orders";
import { checkDeposits } from "./deposits";
import { syncHeliusAddresses } from "./helius-sync";

async function claim(table: "CopyOrder" | "Withdrawal", limit: number): Promise<string[]> {
  // Table name is a fixed union type, never user input, so this interpolation is safe.
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE "${table}" SET status = 'PROCESSING'
    WHERE id IN (
      SELECT id FROM "${table}" WHERE status = 'PENDING'
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  return rows.map((r) => r.id);
}

async function tick() {
  for (const id of await claim("CopyOrder", 10)) {
    processCopyOrder(id).catch((e) => console.error("order", id, e));
  }
  // Withdrawals are admin-only: they stay PENDING until an operator marks them
  // paid (or rejects them) from the admin panel. The server never signs them.
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
    include: { follow: { select: { userId: true } } },
  });
  // A live buy reserves cash before it ever reaches the chain; if it crashed in
  // that window nothing was broadcast, so give the reserved SOL back.
  for (const o of stuck) {
    if (!o.paper && o.side === "BUY") await refundBuy(o.id, o.follow.userId);
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

  setInterval(() => tick().catch(console.error), tickMs);
  setInterval(() => checkDeposits().catch(console.error), depositMs);
  setInterval(() => syncHeliusAddresses().catch(console.error), heliusSyncMs);
  setInterval(() => recoverStuck().catch(console.error), 60_000);

  process.on("unhandledRejection", (e) => {
    console.error("unhandledRejection", e);
    notifyAdmin(`⚠️ server unhandledRejection: ${String(e).slice(0, 300)}`);
  });

  console.log("background loops started");
}
