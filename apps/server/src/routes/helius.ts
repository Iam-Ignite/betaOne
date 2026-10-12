import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, parseSwap } from "@copytrade/core";

const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const heliusRouter = Router();

/**
 * Helius enhanced webhook receiver. Keep this fast and idempotent: authenticate,
 * parse, store, create pending orders, return 200. All trading happens in the loops.
 */
heliusRouter.post("/helius", async (req, res) => {
  // Helius sends the authHeader value you configured (verify header name on a real delivery).
  const auth = req.headers.authorization ?? "";
  if (!process.env.HELIUS_WEBHOOK_SECRET || !safeEq(auth, process.env.HELIUS_WEBHOOK_SECRET)) {
    return res.status(401).send("unauthorized");
  }

  const txs = Array.isArray(req.body) ? (req.body as unknown[]) : [];
  for (const tx of txs) {
    const swap = parseSwap(tx);
    if (!swap) continue;

    const trader = await db.trader.findUnique({ where: { address: swap.trader } });
    if (!trader?.active) continue;

    // Idempotent: signature is unique, so a re-delivered webhook is ignored.
    const leader = await db.leaderSwap.upsert({
      where: { signature: swap.signature },
      update: {},
      create: {
        signature: swap.signature,
        traderId: trader.id,
        side: swap.side,
        tokenMint: swap.tokenMint,
        inputMint: swap.inputMint,
        outputMint: swap.outputMint,
        inAmount: swap.inAmount,
        outAmount: swap.outAmount,
        blockTime: swap.blockTime,
      },
    });

    const follows = await db.follow.findMany({ where: { traderId: trader.id, active: true } });
    if (follows.length === 0) continue;

    await db.copyOrder.createMany({
      skipDuplicates: true, // unique(followId, leaderSignature)
      data: follows.map((f) => ({
        followId: f.id,
        swapId: leader.id,
        leaderSignature: swap.signature,
        side: swap.side,
        tokenMint: swap.tokenMint,
        paper: f.paper,
      })),
    });
  }
  res.json({ ok: true });
});
