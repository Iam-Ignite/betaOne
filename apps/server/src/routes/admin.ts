import { Router, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  db,
  applyLedger,
  setLedgerBalance,
  getLedgerBalances,
  parseUnits,
  evmUsdtDecimals,
  fmtSol,
  fmtUsdt,
  fmtEvmNative,
  evmExplorerTx,
  getPoolAddress,
  getPoolBalance,
  createPoolWallet,
  importPoolKeypair,
  notify,
  editMessage,
} from "@copytrade/core";
import { tradingText, followKeyboard } from "../bot/ui";

export const adminRouter = Router();

const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Basic auth for the whole /admin/* surface. */
adminRouter.use("/admin", (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const [user, pass] = Buffer.from(header.slice(6), "base64").toString().split(":");
    if (safeEq(user ?? "", process.env.ADMIN_USER ?? "") && safeEq(pass ?? "", process.env.ADMIN_PASSWORD ?? "")) {
      return next();
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="admin"').status(401).send("Auth required");
});

const fmtAmount = (asset: string, raw: bigint) =>
  asset === "USDT" ? `${fmtUsdt(raw)} USDT` : asset === "BNB" ? `${fmtEvmNative(raw)} BNB` : `${fmtSol(raw)} SOL`;

/** Escape admin-supplied text so it can be sent safely with Telegram HTML parse mode. */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Everything the admin dashboard renders, pre-formatted so the UI needs no core. */
adminRouter.get("/admin/dashboard", async (_req, res) => {
  const since = new Date(Date.now() - 864e5);
  const [users, follows, pending, failed24h, withdrawals, recentFailed, pendingWithdrawals] =
    await Promise.all([
      db.user.count(),
      db.follow.count({ where: { active: true } }),
      db.copyOrder.count({ where: { status: "PENDING" } }),
      db.copyOrder.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
      db.withdrawal.count({ where: { status: "PENDING" } }),
      db.copyOrder.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, side: true, tokenMint: true, error: true, createdAt: true },
      }),
      db.withdrawal.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: 100,
        include: { user: { select: { telegramId: true } } },
      }),
    ]);

  const [poolAddress, poolBalance, balances] = await Promise.all([
    getPoolAddress(),
    getPoolBalance(),
    db.user.findMany({ select: { balanceSol: true } }),
  ]);
  const liabilitySol = balances.reduce((sum, u) => sum + u.balanceSol, 0n);

  res.json({
    stats: { users, follows, pending, withdrawals, failed24h },
    pool: {
      address: poolAddress,
      balanceSol: fmtSol(poolBalance),
      liabilitySol: fmtSol(liabilitySol),
    },
    pendingWithdrawals: pendingWithdrawals.map((w) => ({
      id: w.id,
      telegramId: w.user.telegramId.toString(),
      asset: w.asset,
      amountLabel: fmtAmount(w.asset, w.amountRaw),
      toAddress: w.toAddress,
      createdAt: w.createdAt.toISOString(),
    })),
    recentFailed: recentFailed.map((o) => ({
      id: o.id,
      side: o.side,
      tokenMint: o.tokenMint,
      error: o.error,
      createdAt: o.createdAt.toISOString(),
    })),
    killSwitch: process.env.TRADING_ENABLED === "true",
  });
});

/** All users as a flat list for the admin's user management table. */
adminRouter.get("/admin/users", async (_req, res) => {
  const [users, pendingByUser] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        telegramId: true,
        username: true,
        status: true,
        balanceSol: true,
        balanceUsdt: true,
        balanceBnb: true,
        createdAt: true,
        wallet: { select: { address: true, evmAddress: true } },
        follows: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            active: true,
            paper: true,
            startedAt: true,
            trader: { select: { address: true } },
          },
        },
      },
    }),
    db.withdrawal.groupBy({
      by: ["userId"],
      where: { status: "PENDING" },
      _count: { _all: true },
    }),
  ]);

  const pendingMap = new Map(pendingByUser.map((p) => [p.userId, p._count._all]));

  res.json({
    count: users.length,
    users: users.map((u) => {
      const active = u.follows.filter((f) => f.active);
      const pending = u.follows.find((f) => f.startedAt === null);
      return {
        telegramId: u.telegramId.toString(),
        username: u.username,
        status: u.status,
        balances: {
          SOL: u.balanceSol.toString(),
          USDT: u.balanceUsdt.toString(),
          BNB: u.balanceBnb.toString(),
        },
        labels: {
          SOL: fmtSol(u.balanceSol),
          USDT: fmtUsdt(u.balanceUsdt),
          BNB: fmtEvmNative(u.balanceBnb),
        },
        follows: {
          total: u.follows.length,
          active: active.length,
          paper: active.filter((f) => f.paper).length,
          live: active.filter((f) => !f.paper).length,
        },
        copytrade: pending ? { id: pending.id, address: pending.trader.address } : null,
        wallet: u.wallet ? { address: u.wallet.address, evmAddress: u.wallet.evmAddress } : null,
        pendingWithdrawals: pendingMap.get(u.id) ?? 0,
        createdAt: u.createdAt.toISOString(),
      };
    }),
  });
});

const DECIMALS: Record<"SOL" | "USDT" | "BNB", number> = {
  SOL: 9,
  USDT: evmUsdtDecimals(),
  BNB: 18,
};

/** Current ledger balances for a user, used to prefill the admin form. */
adminRouter.get("/admin/ledger", async (req, res) => {
  const telegramId = typeof req.query.telegramId === "string" ? req.query.telegramId : null;
  if (!telegramId) return res.status(400).json({ error: "telegramId required" });
  const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) return res.status(404).json({ error: "user not found" });
  const b = await getLedgerBalances(user.id);
  res.json({
    userId: user.id,
    username: user.username,
    balances: { SOL: b.SOL.toString(), USDT: b.USDT.toString(), BNB: b.BNB.toString() },
  });
});

type LedgerBody = {
  telegramId?: string;
  asset?: "SOL" | "USDT" | "BNB";
  mode?: "amount" | "percent";
  action?: "credit" | "debit" | "set";
  amount?: string;
  reason?: string;
};

/**
 * Manual ledger change.
 * - mode=amount (default): credit / debit / set an exact human amount.
 * - mode=percent: scale the current balance by a signed percentage (e.g. "-25" = -25%).
 */
adminRouter.post("/admin/ledger", async (req, res) => {
  const body = (req.body ?? {}) as LedgerBody;
  if (!body.telegramId || !body.asset || !body.amount || !["SOL", "USDT", "BNB"].includes(body.asset)) {
    return res.status(400).json({ error: "telegramId, asset, amount required" });
  }

  const user = await db.user.findUnique({ where: { telegramId: BigInt(body.telegramId) } });
  if (!user) return res.status(404).json({ error: "user not found" });
  const asset = body.asset;

  try {
    if (body.mode === "percent") {
      const pct = Number(body.amount);
      if (!Number.isFinite(pct)) return res.status(400).json({ error: "invalid percent" });
      const current = (await getLedgerBalances(user.id))[asset];
      const pctX100 = BigInt(Math.round(pct * 100));
      const delta = (current * pctX100) / 10000n;
      const balanceAfter =
        delta === 0n
          ? current
          : await applyLedger({
              userId: user.id,
              asset,
              deltaRaw: delta,
              reason: body.reason?.trim() || `admin_percent_${pct}`,
            });
      return res.json({
        ok: true,
        balanceAfter: balanceAfter.toString(),
        balanceAfterLabel: fmtAmount(asset, balanceAfter),
      });
    }

    if (!body.action || !["credit", "debit", "set"].includes(body.action)) {
      return res.status(400).json({ error: "action (credit|debit|set) required" });
    }

    let raw: bigint;
    try {
      raw = parseUnits(body.amount, DECIMALS[asset]);
    } catch {
      return res.status(400).json({ error: "invalid amount" });
    }

    let balanceAfter: bigint;
    if (body.action === "set") {
      balanceAfter = await setLedgerBalance({
        userId: user.id,
        asset,
        targetRaw: raw,
        reason: body.reason?.trim() || "admin_set",
      });
    } else {
      if (raw <= 0n) return res.status(400).json({ error: "amount must be positive" });
      balanceAfter = await applyLedger({
        userId: user.id,
        asset,
        deltaRaw: body.action === "debit" ? -raw : raw,
        reason: body.reason?.trim() || `admin_${body.action}`,
      });
    }
    res.json({
      ok: true,
      balanceAfter: balanceAfter.toString(),
      balanceAfterLabel: fmtAmount(asset, balanceAfter),
    });
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message) });
  }
});

/** Pool trading wallet status. */
adminRouter.get("/admin/pool", async (_req, res) => {
  const address = await getPoolAddress();
  const balance = address ? await getPoolBalance() : 0n;
  res.json({
    hasWallet: !!address,
    address,
    balanceRaw: balance.toString(),
    balanceSol: fmtSol(balance),
  });
});

type PoolBody = { action?: "generate" | "import"; secret?: string };

adminRouter.post("/admin/pool", async (req, res) => {
  const body = (req.body ?? {}) as PoolBody;
  try {
    if (body.action === "generate") {
      const address = await createPoolWallet();
      return res.json({ ok: true, address });
    }
    if (body.action === "import") {
      if (!body.secret?.trim()) return res.status(400).json({ error: "secret required" });
      const address = await importPoolKeypair(body.secret);
      return res.json({ ok: true, address });
    }
    return res.status(400).json({ error: "action must be generate or import" });
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message).slice(0, 300) });
  }
});

type WithdrawalBody = {
  id?: string;
  action?: "paid" | "reject";
  txSignature?: string;
  note?: string;
};

/** Admin actions for a withdrawal request. */
adminRouter.post("/admin/withdrawals", async (req, res) => {
  const body = (req.body ?? {}) as WithdrawalBody;
  const admin = process.env.ADMIN_USER ?? "admin";
  if (!body.id || (body.action !== "paid" && body.action !== "reject")) {
    return res.status(400).json({ error: "id and action (paid|reject) required" });
  }

  const w = await db.withdrawal.findUnique({ where: { id: body.id }, include: { user: true } });
  if (!w) return res.status(404).json({ error: "not found" });
  if (w.status !== "PENDING") return res.status(409).json({ error: `already ${w.status}` });

  const amount = fmtAmount(w.asset, w.amountRaw);

  if (body.action === "paid") {
    const txSignature = body.txSignature?.trim() || null;
    const updated = await db.withdrawal.updateMany({
      where: { id: w.id, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        txSignature,
        approvedBy: admin,
        approvedAt: new Date(),
        note: body.note ?? null,
      },
    });
    if (updated.count === 0) return res.status(409).json({ error: "already actioned" });

    const link =
      txSignature && w.asset !== "SOL"
        ? `\n${evmExplorerTx(txSignature)}`
        : txSignature
          ? `\nhttps://solscan.io/tx/${txSignature}`
          : "";
    await notify(
      w.user.telegramId,
      `✅ Withdrawal sent: <b>${amount}</b>\nTo: <code>${w.toAddress}</code>${link}`,
    );
    return res.json({ ok: true, status: "CONFIRMED" });
  }

  // Reject: refund the reserved amount back to the user's ledger, exactly once.
  const updated = await db.withdrawal.updateMany({
    where: { id: w.id, status: "PENDING" },
    data: {
      status: "FAILED",
      error: body.note ?? "rejected by admin",
      approvedBy: admin,
      approvedAt: new Date(),
    },
  });
  if (updated.count === 0) return res.status(409).json({ error: "already actioned" });

  await applyLedger({
    userId: w.userId,
    asset: w.asset,
    deltaRaw: w.amountRaw,
    reason: "withdraw_refund",
    refId: w.id,
  });
  await notify(
    w.user.telegramId,
    `❌ Withdrawal request rejected${body.note ? `: ${body.note}` : ""}.\n<b>${amount}</b> returned to your balance.`,
  );
  res.json({ ok: true, status: "FAILED" });
});

type MessageBody = {
  telegramId?: string;
  withdrawalId?: string;
  title?: string;
  message?: string;
};

/**
 * Free-form follow-up message from an admin to a single user's Telegram.
 * Target either a user directly (`telegramId`) or via one of their
 * withdrawals (`withdrawalId`). Admin text is HTML-escaped before sending.
 */
adminRouter.post("/admin/message", async (req, res) => {
  const body = (req.body ?? {}) as MessageBody;
  const message = body.message?.trim();
  if (!message) return res.status(400).json({ error: "message required" });
  if (!body.telegramId && !body.withdrawalId) {
    return res.status(400).json({ error: "telegramId or withdrawalId required" });
  }

  let user: { id: string; telegramId: bigint } | null = null;
  let withdrawalContext: string | null = null;

  if (body.withdrawalId) {
    const w = await db.withdrawal.findUnique({
      where: { id: body.withdrawalId },
      include: { user: { select: { id: true, telegramId: true } } },
    });
    if (!w) return res.status(404).json({ error: "withdrawal not found" });
    user = w.user;
    withdrawalContext = `${fmtAmount(w.asset, w.amountRaw)} → ${w.toAddress}`;
  } else {
    user = await db.user.findUnique({
      where: { telegramId: BigInt(body.telegramId as string) },
      select: { id: true, telegramId: true },
    });
    if (!user) return res.status(404).json({ error: "user not found" });
  }

  const title = body.title?.trim();
  const html = `${title ? `<b>${escapeHtml(title)}</b>\n\n` : ""}${escapeHtml(message)}${
    withdrawalContext ? `\n\n<i>${escapeHtml(withdrawalContext)}</i>` : ""
  }`;

  const delivered = await notify(user.telegramId, html);
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "admin_message",
      meta: { withdrawalId: body.withdrawalId ?? null, title: title ?? null },
    },
  });

  res.json({ ok: true, delivered });
});

/** Copytrade requests awaiting the operator to confirm trading has started. */
adminRouter.get("/admin/copytrades", async (_req, res) => {
  const follows = await db.follow.findMany({
    where: { startedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { telegramId: true, username: true } },
      trader: { select: { address: true } },
    },
  });

  res.json({
    pending: follows.map((f) => ({
      id: f.id,
      telegramId: f.user.telegramId.toString(),
      username: f.user.username,
      address: f.trader.address,
      paper: f.paper,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});

type StartCopytradeBody = { followId?: string };

/**
 * Operator confirms a copytrade is really live. Flips the user's "in progress"
 * notice to a success state in place (falling back to a new message), so it reads
 * as an automated status update rather than a manual action.
 */
adminRouter.post("/admin/copytrades/start", async (req, res) => {
  const body = (req.body ?? {}) as StartCopytradeBody;
  if (!body.followId) return res.status(400).json({ error: "followId required" });

  const f = await db.follow.findUnique({
    where: { id: body.followId },
    include: {
      user: { select: { id: true, telegramId: true } },
      trader: { select: { address: true } },
    },
  });
  if (!f) return res.status(404).json({ error: "follow not found" });
  if (f.startedAt) return res.status(409).json({ error: "already started" });

  const updated = await db.follow.updateMany({
    where: { id: f.id, startedAt: null },
    data: { startedAt: new Date() },
  });
  if (updated.count === 0) return res.status(409).json({ error: "already started" });

  const html = tradingText(f.trader.address);
  const keyboard = followKeyboard(f);
  let delivered = false;
  if (f.statusMessageId !== null) {
    delivered = await editMessage(f.user.telegramId, f.statusMessageId, html, keyboard);
  }
  if (!delivered) {
    delivered = await notify(f.user.telegramId, html, keyboard);
  }

  await db.auditLog.create({
    data: { userId: f.user.id, action: "copytrade_started", meta: { followId: f.id } },
  });

  res.json({ ok: true, delivered });
});

