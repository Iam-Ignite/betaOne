import {
  db,
  WSOL,
  fmtSol,
  getOrder,
  executeOrder,
  signOrderTx,
  planCopy,
  assertTokenSafe,
  applyLedger,
  findLedgerEntry,
  getLedgerBalances,
  getPoolKeypair,
  SkipError,
  notify,
} from "@copytrade/core";

const MAX_LEADER_AGE_MS = Number(process.env.MAX_LEADER_AGE_MS ?? 45_000);

const finish = (id: string, data: object) => db.copyOrder.update({ where: { id }, data });

/**
 * Return a user's reserved cash for a failed/abandoned buy. Idempotent: it no-ops
 * unless a "copy_buy" debit exists for this order and no refund has been issued.
 */
export async function refundBuy(orderId: string, userId: string) {
  if (await findLedgerEntry("copy_buy_refund", orderId)) return;
  const debit = await findLedgerEntry("copy_buy", orderId);
  if (!debit || debit.deltaRaw >= 0n) return;
  try {
    await applyLedger({
      userId,
      asset: "SOL",
      deltaRaw: -debit.deltaRaw, // deltaRaw is negative; refund the magnitude
      reason: "copy_buy_refund",
      refId: orderId,
    });
  } catch (e) {
    console.error("refund buy failed", orderId, e);
  }
}

export async function processCopyOrder(orderId: string) {
  const order = await db.copyOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { swap: true, follow: { include: { trader: true, user: true } } },
  });
  const { swap, follow } = order;
  const user = follow.user;
  const tg = user.telegramId;
  const tokenMint = swap.tokenMint;

  try {
    if (process.env.TRADING_ENABLED !== "true") throw new SkipError("trading is globally disabled");
    if (user.status !== "ACTIVE" || !follow.active) throw new SkipError("follow paused");
    if (Date.now() - swap.blockTime.getTime() > MAX_LEADER_AGE_MS) throw new SkipError("leader trade too old");
    const simulate = process.env.SIMULATE_TRADING === "true";
    if (!order.paper && !simulate && process.env.LIVE_TRADING_ALLOWED !== "true") {
      throw new SkipError("live trading not enabled");
    }

    const paperPos = order.paper
      ? await db.paperPosition.findUnique({
          where: { followId_tokenMint: { followId: follow.id, tokenMint } },
        })
      : null;
    const livePos = order.paper
      ? null
      : await db.livePosition.findUnique({
          where: { followId_tokenMint: { followId: follow.id, tokenMint } },
        });

    // Live buys spend the user's pooled-ledger cash; paper uses virtual SOL.
    const solBalance = order.paper ? 10n ** 12n : (await getLedgerBalances(user.id)).SOL;

    const plan = planCopy(swap.side, follow, {
      solBalance,
      reserve: 0n, // the pool, not the user, covers network fees
      haveTokens: order.paper ? !!paperPos : !!(livePos && BigInt(livePos.amountRaw) > 0n),
    });
    if (plan.kind === "skip") throw new SkipError(plan.reason);
    if (plan.kind === "buy" && follow.strictSafety) await assertTokenSafe(tokenMint);

    /* ------------------------------ PAPER ------------------------------ */
    if (order.paper) {
      const inputMint = plan.kind === "buy" ? WSOL : tokenMint;
      const outputMint = plan.kind === "buy" ? tokenMint : WSOL;
      const amount = plan.kind === "buy" ? plan.lamports : BigInt(paperPos!.amountRaw);
      const q = await getOrder({ inputMint, outputMint, amount, slippageBps: follow.slippageBps });
      const out = BigInt(String(q.outAmount ?? "0"));
      if (plan.kind === "buy") {
        await db.paperPosition.upsert({
          where: { followId_tokenMint: { followId: follow.id, tokenMint } },
          create: { followId: follow.id, tokenMint, amountRaw: out.toString(), costLamports: amount },
          update: {}, // v1: ignore repeated buys of the same token
        });
      } else if (paperPos) {
        await db.paperPosition.delete({ where: { id: paperPos.id } });
      }
      await finish(order.id, {
        status: "CONFIRMED",
        inAmountRaw: amount.toString(),
        outAmountRaw: out.toString(),
      });
      const pnl =
        plan.kind === "sell" && paperPos ? ` (P/L ${fmtSol(out - paperPos.costLamports)} SOL)` : "";
      await notify(tg, `📝 <b>Paper ${swap.side}</b> ${tokenMint.slice(0, 6)}…${pnl}`);
      return;
    }

    /* ------------------ LIVE — simulated (no chain, no pool) ------------------ */
    if (simulate) {
      if (plan.kind === "buy") {
        try {
          await applyLedger({
            userId: user.id,
            asset: "SOL",
            deltaRaw: -plan.lamports,
            reason: "copy_buy",
            refId: order.id,
          });
        } catch {
          throw new SkipError("not enough balance");
        }
        let out: bigint;
        try {
          const q = await getOrder({
            inputMint: WSOL,
            outputMint: tokenMint,
            amount: plan.lamports,
            slippageBps: follow.slippageBps,
          });
          out = BigInt(String(q.outAmount ?? "0"));
        } catch (e) {
          await refundBuy(order.id, user.id);
          throw e;
        }
        const prevAmount = livePos ? BigInt(livePos.amountRaw) : 0n;
        const prevCost = livePos ? livePos.costLamports : 0n;
        await db.livePosition.upsert({
          where: { followId_tokenMint: { followId: follow.id, tokenMint } },
          create: { followId: follow.id, tokenMint, amountRaw: out.toString(), costLamports: plan.lamports },
          update: { amountRaw: (prevAmount + out).toString(), costLamports: prevCost + plan.lamports },
        });
        await finish(order.id, { status: "CONFIRMED", outAmountRaw: out.toString() });
        await notify(
          tg,
          `✅ <b>BUY</b> ${tokenMint.slice(0, 6)}… copied from <b>${follow.trader.label}</b>\nSpent ${fmtSol(plan.lamports)} SOL`,
        );
        return;
      }

      // SELL
      const amount = BigInt(livePos!.amountRaw);
      const q = await getOrder({
        inputMint: tokenMint,
        outputMint: WSOL,
        amount,
        slippageBps: follow.slippageBps,
      });
      const proceeds = BigInt(String(q.outAmount ?? "0"));
      await applyLedger({
        userId: user.id,
        asset: "SOL",
        deltaRaw: proceeds,
        reason: "copy_sell",
        refId: order.id,
      });
      await db.livePosition.delete({ where: { id: livePos!.id } });
      const pnl = proceeds - livePos!.costLamports;
      await finish(order.id, { status: "CONFIRMED", outAmountRaw: proceeds.toString() });
      await notify(
        tg,
        `✅ <b>SELL</b> ${tokenMint.slice(0, 6)}… copied from <b>${follow.trader.label}</b>\n` +
          `Received ${fmtSol(proceeds)} SOL (P/L ${fmtSol(pnl)})`,
      );
      return;
    }

    /* -------------------------- LIVE (pooled) -------------------------- */
    const pool = await getPoolKeypair();
    if (!pool) throw new SkipError("pool wallet not configured");
    const poolAddress = pool.publicKey.toBase58();

    let reserved: bigint | null = null;
    try {
      if (plan.kind === "buy") {
        // Reserve the user's cash before touching the chain. planCopy already
        // guaranteed it fits, but the atomic guard also protects against races.
        try {
          await applyLedger({
            userId: user.id,
            asset: "SOL",
            deltaRaw: -plan.lamports,
            reason: "copy_buy",
            refId: order.id,
          });
        } catch {
          throw new SkipError("not enough balance");
        }
        reserved = plan.lamports;

        const jup = await getOrder({
          inputMint: WSOL,
          outputMint: tokenMint,
          amount: plan.lamports,
          taker: poolAddress,
          slippageBps: follow.slippageBps,
        });
        if (!jup.transaction) throw new Error(`Jupiter returned no transaction: ${JSON.stringify(jup).slice(0, 300)}`);

        await finish(order.id, {
          status: "SUBMITTED",
          requestId: jup.requestId,
          inAmountRaw: plan.lamports.toString(),
        });
        const res = await executeOrder(signOrderTx(jup, pool), jup.requestId);
        if (String(res.status).toLowerCase() !== "success") throw new Error(JSON.stringify(res).slice(0, 300));
        const signature = res.signature ? String(res.signature) : null;
        const out = res.outputAmountResult ? String(res.outputAmountResult) : String(jup.outAmount ?? "0");

        const prevAmount = livePos ? BigInt(livePos.amountRaw) : 0n;
        const prevCost = livePos ? livePos.costLamports : 0n;
        await db.livePosition.upsert({
          where: { followId_tokenMint: { followId: follow.id, tokenMint } },
          create: { followId: follow.id, tokenMint, amountRaw: out, costLamports: plan.lamports },
          update: { amountRaw: (prevAmount + BigInt(out)).toString(), costLamports: prevCost + plan.lamports },
        });
        await finish(order.id, { status: "CONFIRMED", txSignature: signature, outAmountRaw: out });
        reserved = null; // committed, never refunded
        await notify(
          tg,
          `✅ <b>BUY</b> ${tokenMint.slice(0, 6)}… copied from <b>${follow.trader.label}</b>\n` +
            `Spent ${fmtSol(plan.lamports)} SOL\nhttps://solscan.io/tx/${signature}`,
        );
        return;
      }

      // SELL: liquidate the user's accounted position from the pool.
      const amount = BigInt(livePos!.amountRaw);
      const jup = await getOrder({
        inputMint: tokenMint,
        outputMint: WSOL,
        amount,
        taker: poolAddress,
        slippageBps: follow.slippageBps,
      });
      if (!jup.transaction) throw new Error(`Jupiter returned no transaction: ${JSON.stringify(jup).slice(0, 300)}`);

      await finish(order.id, {
        status: "SUBMITTED",
        requestId: jup.requestId,
        inAmountRaw: amount.toString(),
      });
      const res = await executeOrder(signOrderTx(jup, pool), jup.requestId);
      if (String(res.status).toLowerCase() !== "success") throw new Error(JSON.stringify(res).slice(0, 300));
      const signature = res.signature ? String(res.signature) : null;
      const proceeds = BigInt(String(res.outputAmountResult ?? jup.outAmount ?? "0"));

      await applyLedger({
        userId: user.id,
        asset: "SOL",
        deltaRaw: proceeds,
        reason: "copy_sell",
        refId: order.id,
      });
      await db.livePosition.delete({ where: { id: livePos!.id } });
      const pnl = proceeds - livePos!.costLamports;
      await finish(order.id, { status: "CONFIRMED", txSignature: signature, outAmountRaw: proceeds.toString() });
      await notify(
        tg,
        `✅ <b>SELL</b> ${tokenMint.slice(0, 6)}… copied from <b>${follow.trader.label}</b>\n` +
          `Received ${fmtSol(proceeds)} SOL (P/L ${fmtSol(pnl)})\nhttps://solscan.io/tx/${signature}`,
      );
    } catch (e) {
      if (reserved !== null) await refundBuy(order.id, user.id);
      throw e;
    } finally {
      pool.secretKey.fill(0);
    }
  } catch (e: any) {
    if (e instanceof SkipError) {
      await finish(order.id, { status: "SKIPPED", skipReason: e.message });
      return; // do not spam users with every skip
    }
    await finish(order.id, { status: "FAILED", error: String(e?.message ?? e).slice(0, 500) });
    await notify(tg, `❌ Copy trade failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}
