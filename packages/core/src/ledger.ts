import { db } from "./db";

export type LedgerAsset = "SOL" | "USDT" | "BNB";

type BalanceField = "balanceSol" | "balanceUsdt" | "balanceBnb";

const FIELD: Record<LedgerAsset, BalanceField> = {
  SOL: "balanceSol",
  USDT: "balanceUsdt",
  BNB: "balanceBnb",
};

export interface LedgerBalances {
  SOL: bigint;
  USDT: bigint;
  BNB: bigint;
}

/**
 * Apply a signed delta (in the asset's raw units) to a user's internal balance
 * and append an audit entry. Positive = credit, negative = debit. Throws when a
 * debit would take the balance below zero.
 */
export async function applyLedger(opts: {
  userId: string;
  asset: LedgerAsset;
  deltaRaw: bigint;
  reason: string;
  refId?: string | null;
}): Promise<bigint> {
  const field = FIELD[opts.asset];

  if (opts.deltaRaw >= 0n) {
    await db.user.update({
      where: { id: opts.userId },
      data: { [field]: { increment: opts.deltaRaw } } as never,
    });
  } else {
    // Atomic guard so concurrent debits can never overdraw the balance.
    const res = await db.user.updateMany({
      where: { id: opts.userId, [field]: { gte: -opts.deltaRaw } } as never,
      data: { [field]: { increment: opts.deltaRaw } } as never,
    });
    if (res.count === 0) throw new Error(`insufficient ${opts.asset} balance`);
  }

  const row = await db.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { [field]: true } as never,
  });
  const balanceAfter = (row as unknown as Record<BalanceField, bigint>)[field];

  await db.ledgerEntry.create({
    data: {
      userId: opts.userId,
      asset: opts.asset,
      deltaRaw: opts.deltaRaw,
      balanceAfter,
      reason: opts.reason,
      refId: opts.refId ?? null,
    },
  });

  return balanceAfter;
}

/** Current pooled-ledger balances for a user. */
export async function getLedgerBalances(userId: string): Promise<LedgerBalances> {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { balanceSol: true, balanceUsdt: true, balanceBnb: true },
  });
  return { SOL: u.balanceSol, USDT: u.balanceUsdt, BNB: u.balanceBnb };
}

/** Most recent ledger entry matching a reason + ref, or null. Used for idempotent refunds. */
export async function findLedgerEntry(reason: string, refId: string) {
  return db.ledgerEntry.findFirst({
    where: { reason, refId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Set a user's balance to an exact value. The difference from the current
 * balance is recorded as a single ledger entry, so the audit trail always adds
 * up to the shown balance.
 */
export async function setLedgerBalance(opts: {
  userId: string;
  asset: LedgerAsset;
  targetRaw: bigint;
  reason: string;
  refId?: string | null;
}): Promise<bigint> {
  if (opts.targetRaw < 0n) throw new Error("target balance cannot be negative");
  const current = await getLedgerBalances(opts.userId);
  const delta = opts.targetRaw - current[opts.asset];
  if (delta === 0n) return opts.targetRaw;
  return applyLedger({
    userId: opts.userId,
    asset: opts.asset,
    deltaRaw: delta,
    reason: opts.reason,
    refId: opts.refId,
  });
}
