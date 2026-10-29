import { InlineKeyboard } from "grammy";
import { bot, type Ctx } from "./instance";
import { db, getPlan, PLAN_ORDER, WOLF_PLANS, type PlanType } from "@copytrade/core";
import { escapeHtml } from "./ui";

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type PickTemplate = {
  ticker: string;
  name: string;
  mint: string;
  entry: number;
  tp1: number;
  tp2: number;
  sl: number;
  reason: string;
};

/**
 * Curated demo setups. Swap this for a live Helius/Jupiter scanner later — the
 * gating, copy and plan logic stay exactly the same.
 */
export const PICKS: PickTemplate[] = [
  {
    ticker: "$HOWL",
    name: "HowlPack",
    mint: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
    entry: 0.0421,
    tp1: 0.0463,
    tp2: 0.0512,
    sl: 0.0389,
    reason: "Reclaimed range high on rising volume with healthy liquidity.",
  },
  {
    ticker: "$FANG",
    name: "FangCoin",
    mint: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    entry: 1.284,
    tp1: 1.41,
    tp2: 1.56,
    sl: 1.19,
    reason: "Higher-low structure forming after a liquidity sweep.",
  },
  {
    ticker: "$CLAW",
    name: "ClawX",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    entry: 0.00785,
    tp1: 0.00863,
    tp2: 0.00945,
    sl: 0.00721,
    reason: "Volume expansion into resistance with strong holder growth.",
  },
  {
    ticker: "$LUNA",
    name: "LunaWolf",
    mint: "So11111111111111111111111111111111111111112",
    entry: 0.215,
    tp1: 0.236,
    tp2: 0.259,
    sl: 0.197,
    reason: "Breakout retest holding above the prior consolidation zone.",
  },
  {
    ticker: "$ALPHA",
    name: "AlphaPrime",
    mint: "7dHbWXYWjH9w5QzK3vJ8mN2pR4sT6uV8wX9yZ1aB3cD5eF",
    entry: 0.0892,
    tp1: 0.0981,
    tp2: 0.1089,
    sl: 0.0821,
    reason: "Cup-and-handle breakout with increasing buy pressure on dips.",
  },
  {
    ticker: "$BETA",
    name: "BetaProtocol",
    mint: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    entry: 2.34,
    tp1: 2.57,
    tp2: 2.84,
    sl: 2.15,
    reason: "Ascending triangle nearing apex with volume drying up.",
  },
  {
    ticker: "$GAMMA",
    name: "GammaRay",
    mint: "GmMa11111111111111111111111111111111111111111",
    entry: 0.00123,
    tp1: 0.00135,
    tp2: 0.00150,
    sl: 0.00112,
    reason: "Micro-cap with whale accumulation and locked liquidity.",
  },
  {
    ticker: "$OMEGA",
    name: "OmegaPoint",
    mint: "OmEgA11111111111111111111111111111111111111111",
    entry: 0.456,
    tp1: 0.501,
    tp2: 0.556,
    sl: 0.418,
    reason: "Double bottom confirmed with RSI divergence on daily.",
  },
  {
    ticker: "$PAW",
    name: "PawPrint",
    mint: "PaWpRiNt11111111111111111111111111111111111111111",
    entry: 0.00345,
    tp1: 0.00379,
    tp2: 0.00418,
    sl: 0.00318,
    reason: "Symmetrical triangle breakout with 3x volume surge.",
  },
  {
    ticker: "$SNARL",
    name: "SnarlToken",
    mint: "SnArLtOkEn1111111111111111111111111111111111111111",
    entry: 1.87,
    tp1: 2.05,
    tp2: 2.28,
    sl: 1.72,
    reason: "Flag pattern continuation after strong momentum candle.",
  },
  {
    ticker: "$HUNT",
    name: "HunterDAO",
    mint: "HuNtDaO11111111111111111111111111111111111111111111",
    entry: 0.0678,
    tp1: 0.0745,
    tp2: 0.0821,
    sl: 0.0629,
    reason: "Bullish pennant forming with declining volatility.",
  },
  {
    ticker: "$PACK",
    name: "PackLeader",
    mint: "PaCkLeAdEr111111111111111111111111111111111111111111",
    entry: 3.21,
    tp1: 3.53,
    tp2: 3.88,
    sl: 2.97,
    reason: "Inverse head and shoulders with neckline breakout.",
  },
  {
    ticker: "$ROAR",
    name: "RoarFinance",
    mint: "RoArFiNaNcE11111111111111111111111111111111111111111",
    entry: 0.00089,
    tp1: 0.00098,
    tp2: 0.00109,
    sl: 0.00081,
    reason: "Extreme oversold bounce with bullish engulfing candle.",
  },
  {
    ticker: "$WOLF",
    name: "WolfCoin",
    mint: "WoLfCoIn1111111111111111111111111111111111111111111111",
    entry: 0.156,
    tp1: 0.171,
    tp2: 0.189,
    sl: 0.144,
    reason: "Fibonacci 0.618 retest holding with stochastic crossover.",
  },
];

function pickForPlan(plan: PlanType): PickTemplate {
  // Higher ranks surface the stronger setups later in the curated list.
  const pool = plan === "ALPHA" ? PICKS : plan === "BETA" ? PICKS.slice(0, 3) : PICKS.slice(0, 2);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Returns true when a paid rank has lapsed; downgrades the user to Omega. */
export async function enforcePlanExpiry(ctx: Ctx): Promise<boolean> {
  const user = ctx.user;
  if (user.planType === "OMEGA" || !user.planEndDate) return false;
  if (new Date(user.planEndDate).getTime() > Date.now()) return false;

  await db.user.update({
    where: { id: user.id },
    data: { planType: "OMEGA", planEndDate: null },
  });
  ctx.user.planType = "OMEGA";
  ctx.user.planEndDate = null;
  return true;
}

async function sendBestCoin(ctx: Ctx) {
  const lapsed = await enforcePlanExpiry(ctx);
  const plan = getPlan(ctx.user.planType);

  if (lapsed) {
    await ctx.reply(
      `⏳ <b>Your paid plan has ended</b>\n\n` +
        `You're back on the free <b>${escapeHtml(plan.displayName)}</b> plan, which includes ${plan.maxPicksPerDay} pick per day.\n\n` +
        `You can rejoin a plan anytime.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🐺 See plans", "plan:menu")
          .row()
          .text("🏠 Main menu", "menu"),
      },
    );
    return;
  }

  const usedToday = await db.auditLog.count({
    where: { userId: ctx.user.id, action: "coin_pick", createdAt: { gte: startOfToday() } },
  });

  if (usedToday >= plan.maxPicksPerDay) {
    const next = PLAN_ORDER[PLAN_ORDER.indexOf(plan.name) + 1];
    const upsell = next
      ? `\n\n⬆️ Want more picks today? <b>${escapeHtml(WOLF_PLANS[next].displayName)}</b> gives you ${WOLF_PLANS[next].maxPicksPerDay} per day.`
      : "";
    return ctx.reply(
      `🐺 <b>You've used your ${plan.maxPicksPerDay} pick${plan.maxPicksPerDay === 1 ? "" : "s"} for today</b> on the <b>${escapeHtml(plan.displayName)}</b> plan.${upsell}\n\nYour picks reset at midnight.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🐺 See plans", "plan:menu")
          .row()
          .text("🏠 Main menu", "menu"),
      },
    );
  }

  const pick = pickForPlan(plan.name);

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "coin_pick",
      meta: { plan: plan.name, ticker: pick.ticker, mint: pick.mint },
    },
  });

  const remaining = plan.maxPicksPerDay - usedToday - 1;
  const next = PLAN_ORDER[PLAN_ORDER.indexOf(plan.name) + 1];

  let body = `🐺 <b>Today's coin pick</b> · ${escapeHtml(plan.displayName)}\n\n`;
  body += `🪙 <b>Coin:</b> ${escapeHtml(pick.ticker)} (${escapeHtml(pick.name)})\n`;
  body += `🔗 <b>Contract:</b> <code>${escapeHtml(pick.mint)}</code>\n`;
  body += `🌐 <b>Network:</b> Solana\n\n`;
  body += `📈 <b>The trade plan</b>\n`;
  body += `🟢 <b>Buy around:</b> $${pick.entry}\n`;
  body += `🎯 <b>Take profit:</b> $${pick.tp1} (first target) · $${pick.tp2} (second target)\n`;
  body += `🛑 <b>Sell if it drops to:</b> $${pick.sl}\n\n`;
  body += `💡 <b>Why this coin:</b> ${escapeHtml(pick.reason)}\n\n`;
  body += `⚡ <b>Potential ROI:</b> ${escapeHtml(plan.roiRange)}\n`;
  body += `🛡 <b>Risk level:</b> ${escapeHtml(plan.risk)}\n`;
  body += `⏰ <b>Good for:</b> the next 2–4 hours\n`;
  body += `📊 <b>Picks left today:</b> ${remaining}\n`;
  if (next) {
    body += `\n⬆️ Want more picks? See <b>${escapeHtml(WOLF_PLANS[next].displayName)}</b> in /plans.`;
  }
  body += `\n\n<i>This is a market suggestion, not financial advice. Only invest what you can afford to lose.</i>`;

  return ctx.reply(body, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .copyText("📋 Copy contract address", pick.mint)
      .row()
      .text("❓ What do these mean?", "pick:help")
      .row()
      .text("🐺 Plans", "plan:menu")
      .text("🏠 Main menu", "menu"),
  });
}

bot.command(["bestcoin", "findcoin", "hunt"], sendBestCoin);
bot.callbackQuery("bestcoin", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return sendBestCoin(ctx);
});

bot.callbackQuery("pick:help", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return ctx.reply(
    `❓ <b>How to read a coin pick</b>\n\n` +
      `🟢 <b>Buy around</b> — the price range where the setup looks good. Try not to pay much more.\n\n` +
      `🎯 <b>Take profit</b> — prices where you might sell to lock in gains. TP1 is the safer first target, TP2 is more ambitious.\n\n` +
      `🛑 <b>Sell if it drops to</b> — your safety line. If the price falls this far, the setup failed and you may want to limit losses.\n\n` +
      `⚡ <b>Potential ROI</b> — an estimate based on the plan, not a promise.\n\n` +
      `💡 Never invest more than you can afford to lose. Prices move fast in crypto.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🔍 Back to my pick", "bestcoin")
        .row()
        .text("🏠 Main menu", "menu"),
    },
  );
});
