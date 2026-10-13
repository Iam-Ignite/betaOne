import { Router } from "express";
import { db } from "@copytrade/core";
import { validateInitData } from "../lib/telegram";

export const miniRouter = Router();

/** Telegram Mini App data endpoint. The user id comes from validated initData. */
miniRouter.post("/mini/follows", async (req, res) => {
  const { initData } = (req.body ?? {}) as { initData?: string };
  const tg = initData ? validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN ?? "") : null;
  if (!tg) return res.status(401).json({ error: "invalid initData" });

  // Auto-create user if they haven't started the bot yet (like bot middleware does)
  let user = await db.user.findUnique({
    where: { telegramId: BigInt(tg.id) },
    include: { wallet: true, follows: { include: { trader: true } } },
  });
  if (!user) {
    user = await db.user.create({
      data: { telegramId: BigInt(tg.id), username: tg.username },
      include: { wallet: true, follows: { include: { trader: true } } },
    });
  }

  res.json({
    wallet: user.wallet?.address ?? null,
    follows: user.follows.map((f) => ({
      id: f.id,
      trader: f.trader.label,
      address: f.trader.address,
      active: f.active,
      paper: f.paper,
      buyLamports: f.buyLamports.toString(),
      maxLamports: f.maxLamports.toString(),
      slippageBps: f.slippageBps,
    })),
  });
});
