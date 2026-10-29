import { InlineKeyboard } from "grammy";
import { bot, type Ctx } from "./instance";
import {
  fmtSol,
  fmtUsdt,
  fmtEvmNative,
  getLedgerBalances,
  applyLedger,
  parseUsdt,
  toBigInt,
  env,
  db,
  type PlanType,
  type PlanDurationDays,
  PLAN_ORDER,
  WOLF_PLANS,
  getPlan,
} from "@copytrade/core";
import { depositKeyboard, escapeHtml, mainMenuKeyboard } from "./ui";
import { ensureWallet } from "./wallet";
import { enforcePlanExpiry } from "./signals";
import {
  generateSubscriberTradingStatus,
  generateNonSubscriberTradingStatus,
  getTradingStatusKeyboard,
} from "./trading-status";

export const COMMANDS = [
  { command: "start", description: "Open the main menu" },
  { command: "help", description: "Step-by-step guide for beginners" },
  { command: "deposit", description: "Add funds to your wallet" },
  { command: "balance", description: "Check how much you have" },
  { command: "withdraw", description: "Send funds back to your wallet" },
  { command: "copytrade", description: "Copy another trader" },
  { command: "bestcoin", description: "See today's coin pick" },
  { command: "bots", description: "View bots and upgrade" },
  { command: "wallet", description: "See your wallet addresses" },
  { command: "refer", description: "Your invite code and rewards" },
  { command: "trading", description: "Check current trading status" },
  { command: "cancel", description: "Stop what you're doing" },
];

function greeting(ctx: Ctx) {
  const u = ctx.from;
  if (u?.username) return `@${u.username}`;
  return escapeHtml(u?.first_name || "there");
}

function startText(ctx: Ctx) {
  const rank = getPlan(ctx.user.planType);
  const w = ctx.user.wallet;
  let body =
    `🐺 <b>Welcome to Alpha Trading Bot!</b>\n\n` +
    `Hi ${greeting(ctx)} 👋 I'm your crypto trading assistant. You don't need any experience — I'll walk you through everything one step at a time.\n\n` +
    `<b>What I can do for you:</b>\n` +
    `🔍 Find a coin worth watching (a "pick")\n` +
    `📈 Automatically copy an experienced trader\n` +
    `💳 Hold your funds in a personal wallet only you can use\n\n` +
    `<b>New here? Start with 3 easy steps:</b>\n` +
    `1️⃣ Tap <b>💳 Deposit</b> and send some funds\n` +
    `2️⃣ Tap <b>📈 Copy a trader</b> to follow experienced traders.\n` +
    `3️⃣ I'll message you whenever something happens\n\n` +
    `🏆 <b>Your rank:</b> ${escapeHtml(rank.displayName)} · ${escapeHtml(rank.roiRange)} potential ROI\n` +
    `🎁 <b>Your referral code:</b> <code>${escapeHtml(ctx.user.referralCode ?? "None")}</code>`;

  body += w?.address && w.evmAddress
    ? `\n\n✅ <b>Your wallet is ready.</b> Tap <b>💳 Deposit</b> to see your addresses.`
    : `\n\n💡 <b>No wallet yet?</b> I'll create one for you automatically the first time you deposit.`;

  body += `\n\n💡 <b>New here?</b> Tap <b>❓ How it works</b> to learn step by step.`;
  return body;
}

function startKeyboard(ctx: Ctx) {
  const w = ctx.user.wallet;
  if (!w?.address || !w.evmAddress) return mainMenuKeyboard();
  return new InlineKeyboard()
    .copyText("🟡 Copy Solana address", w.address)
    .row()
    .copyText("🟢 Copy USDT address", w.evmAddress!)
    .row()
    .text("💳 Deposit", "deposit")
    .text("💰 Balance", "balance")
    .row()
    .text("📈 Copy a trader", "copytrade")
    .text("🔍 Free coin pick", "bestcoin")
    .row()
    .text("📊 Trading Status", "trading")
    .text("🐺 Plans", "plan:menu")
    .row()
    .text("❓ How it works", "help");
}

bot.command("start", async (ctx) => {
  await enforcePlanExpiry(ctx);
  return ctx.reply(startText(ctx), { parse_mode: "HTML", reply_markup: startKeyboard(ctx) });
});

bot.callbackQuery("menu", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  try {
    await enforcePlanExpiry(ctx);
    await ctx.reply(startText(ctx), { parse_mode: "HTML", reply_markup: startKeyboard(ctx) });
  } catch {}
});

const HELP_TEXT =
  `🐺 <b>How this bot works</b>\n\n` +
  `<b>1. 💳 Deposit</b>\n` +
  `Tap /deposit to get your personal wallet address, then send SOL or USDT to it from any exchange or wallet. I'll confirm as soon as it arrives.\n\n` +
  `<b>2. Pick how you want to trade</b>\n` +
  `• <b>📈 Copy a trader</b> — Paste any Solana trader's address and I'll copy their trades for you.\n` +
  `• <b>🔍 Free coin pick</b> — Get a pick to look at and trade manually.\n\n` +
  `<b>3. 💸 Withdraw</b>\n` +
  `Tap /withdraw to send funds back to your own wallet or exchange. You'll set a 4–8 digit PIN the first time to keep your money safe.\n\n` +
  `<b>Simple words explained:</b>\n` +
  `• <b>Wallet address</b> — like an account number for crypto. Share it to receive funds.\n` +
  `• <b>Copy trading</b> — automatically repeating another trader's trades.\n` +
  `• <b>Entry</b> — the price to buy at. <b>TP</b> — where to take profit. <b>SL</b> — where to cut losses.\n` +
  `• <b>Paper / practice mode</b> — test with virtual money, no real funds at risk.\n\n` +
  `<b>All commands:</b>\n` +
  COMMANDS.map((c) => `/${c.command} — ${escapeHtml(c.description)}`).join("\n") +
  `\n\n<i>Coin picks are market suggestions, not financial advice. Only invest what you can afford to lose.</i>`;

function helpKeyboard() {
  return new InlineKeyboard()
    .text("📈 Copy a trader", "copytrade")
    .text("🔍 Free coin pick", "bestcoin")
    .row()
    .text("💳 Deposit", "deposit")
    .text("⬅️ Main menu", "menu");
}

bot.command("help", (ctx) =>
  ctx.reply(HELP_TEXT, { parse_mode: "HTML", reply_markup: helpKeyboard() }));

bot.callbackQuery("help", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML", reply_markup: helpKeyboard() });
});

bot.command("refer", async (ctx) => {
  const user = ctx.user;
  const code = user.referralCode ?? "None";
  const friendsCount = await db.user.count({ where: { referredBy: user.id } as any });
  let link = "";
  try {
    const me = await ctx.api.getMe();
    link = `https://t.me/${me.username}?start=${code}`;
  } catch {}
  let body = `🎁 <b>Invite friends, earn rewards</b>\n\n`;
  body += `Share your personal invite code:\n<code>${escapeHtml(code)}</code>\n\n`;
  if (link) {
    body += `Share your personal invite link:\n<code>${escapeHtml(link)}</code>\n\n`;
  }
  body += `👥 <b>Friends joined:</b> ${friendsCount}\n`;
  body += `💰 <b>Rewards earned:</b> ${fmtSol(toBigInt(user.referralEarnings))} SOL\n\n`;
  body += `❤️ <b>You'll earn 5% of every successful trade profit your friends make when copying trades.</b>\n\n`;
  body += `Just send them your link or code and ask them to tap /start.`;
  return ctx.reply(body, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("⬅️ Main menu", "menu"),
  });
});

function planShopKeyboard(current: PlanType) {
  const kb = new InlineKeyboard();
  // Highest rank first so the pack hierarchy reads top-down.
  for (const key of [...PLAN_ORDER].reverse()) {
    const p = WOLF_PLANS[key];
    const active = key === current ? " ✅" : "";
    const priceStr = key === "OMEGA" ? "Free" : `from ${p.durations[14].priceUsdt} USDT`;
    kb.text(`${p.emoji} ${p.displayName} · ${priceStr}${active}`, `plan:view:${key}`).row();
  }
  kb.text("⬅️ Main menu", "menu");
  return kb;
}

function planShopText(current: PlanType, planEndDate?: Date | null) {
  const me = getPlan(current);
  let body = `🐺 <b>Wolf Pack Plans</b>\n\n`;
  body += `Subscribe with your bot USDT balance. Choose between a <b>14-day</b> sprint or <b>30-day</b> monthly pack.\n`;
  body += `Higher ranks unlock more high-conviction coin picks every day.\n\n`;
  body += `👑 <b>Your current plan:</b> ${escapeHtml(me.displayName)}\n`;
  if (current !== "OMEGA" && planEndDate) {
    const daysLeft = Math.max(0, Math.ceil((new Date(planEndDate).getTime() - Date.now()) / 86_400_000));
    body += `📅 <b>Active until:</b> ${new Date(planEndDate).toLocaleDateString()} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)\n`;
  }
  body += `📊 <b>Picks per day:</b> ${me.maxPicksPerDay} · 🎯 <b>Potential ROI:</b> ${escapeHtml(me.roiRange)}\n\n`;
  body += `<b>Compare plans & durations:</b>\n`;
  for (const key of PLAN_ORDER) {
    const p = WOLF_PLANS[key];
    if (key === "OMEGA") {
      body += `${p.emoji} <b>${escapeHtml(p.displayName)}</b> — FREE\n`;
    } else {
      body += `${p.emoji} <b>${escapeHtml(p.displayName)}</b> — 14d: <b>${p.durations[14].priceUsdt} USDT</b> · 30d: <b>${p.durations[30].priceUsdt} USDT</b>\n`;
    }
    body += `   ${p.maxPicksPerDay} pick${p.maxPicksPerDay === 1 ? "" : "s"}/day · Potential ROI ${escapeHtml(p.roiRange)}\n`;
  }
  body += `\nTap a plan below to choose your duration and subscribe.\n`;
  body += `<i>Potential ROI is an estimate, not a guarantee.</i>`;
  return body;
}

function planDetailText(key: PlanType, balanceUsdt?: bigint) {
  const p = WOLF_PLANS[key];
  let body = `${p.emoji} <b>${escapeHtml(p.displayName.toUpperCase())}</b>\n\n`;
  body += `<i>${escapeHtml(p.tagline)}</i>\n\n`;
  if (key === "OMEGA") {
    body += `💵 <b>Price:</b> Free\n`;
    body += `⏳ <b>Duration:</b> Unlimited\n`;
  } else {
    body += `💵 <b>Duration & Pricing:</b>\n`;
    body += `• ⚡ <b>14 Days:</b> ${p.durations[14].priceUsdt} USDT\n`;
    body += `• 🔥 <b>30 Days:</b> ${p.durations[30].priceUsdt} USDT\n`;
  }
  if (balanceUsdt !== undefined) {
    body += `\n💼 <b>Your USDT Balance:</b> ${fmtUsdt(balanceUsdt)} USDT\n`;
  }
  body += `\n🎯 <b>Potential ROI:</b> ${escapeHtml(p.roiRange)}\n`;
  body += `📊 <b>Picks per day:</b> ${p.maxPicksPerDay}\n\n`;
  body += `✅ <b>What you get:</b>\n`;
  body += p.features.map((f) => `• ${escapeHtml(f)}`).join("\n");
  body += `\n\n<i>Subscriptions are paid with money in your bot wallet. Potential ROI is an estimate, not a guarantee.</i>`;
  return body;
}

function planDetailKeyboard(key: PlanType, current: PlanType, planEndDate?: Date | null) {
  const kb = new InlineKeyboard();
  const isCurrent = key === current;
  const isUnexpired = isCurrent && planEndDate && new Date(planEndDate).getTime() > Date.now();

  if (key === "OMEGA") {
    kb.text("✅ Current rank (Free)", "plan:menu").row();
  } else {
    const p = WOLF_PLANS[key];
    const prefix14 = isUnexpired ? "Extend +14 Days" : "Subscribe 14 Days";
    const prefix30 = isUnexpired ? "Extend +30 Days" : "Subscribe 30 Days";
    kb.text(`⚡ ${prefix14} · ${p.durations[14].priceUsdt} USDT`, `plan:buy:${key}:14`).row();
    kb.text(`🔥 ${prefix30} · ${p.durations[30].priceUsdt} USDT`, `plan:buy:${key}:30`).row();
  }
  kb.text("⬅️ Back to plans", "plan:menu").row();
  kb.text("🏠 Main menu", "menu");
  return kb;
}

async function sendPlanShop(ctx: Ctx, edit = false) {
  await enforcePlanExpiry(ctx);
  const text = planShopText(ctx.user.planType, ctx.user.planEndDate);
  const opts = { parse_mode: "HTML" as const, reply_markup: planShopKeyboard(ctx.user.planType) };
  if (edit) {
    await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
  } else {
    await ctx.reply(text, opts);
  }
}

bot.command(["plan", "plans", "bots"], async (ctx) => {
  // `/plan PRO`-style manual upgrades are no longer accepted — every change
  // goes through the subscription cards so installments/expiry stay consistent.
  return sendPlanShop(ctx);
});

bot.callbackQuery("plan:menu", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return sendPlanShop(ctx, true);
});

bot.callbackQuery(/^plan:view:(OMEGA|GAMMA|BETA|ALPHA)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await enforcePlanExpiry(ctx);
  const key = ctx.match[1] as PlanType;
  const balances = await getLedgerBalances(ctx.user.id).catch(() => ({ USDT: 0n, SOL: 0n, BNB: 0n }));
  const opts = {
    parse_mode: "HTML" as const,
    reply_markup: planDetailKeyboard(key, ctx.user.planType, ctx.user.planEndDate),
  };
  const text = planDetailText(key, balances.USDT);
  await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
});

bot.callbackQuery(/^plan:buy:(OMEGA|GAMMA|BETA|ALPHA)(?::(14|30))?$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await enforcePlanExpiry(ctx);
  const key = ctx.match[1] as PlanType;
  const days = (Number(ctx.match[2] ?? 30) === 14 ? 14 : 30) as PlanDurationDays;
  const p = WOLF_PLANS[key];
  const user = ctx.user;

  if (key === "OMEGA") {
    return ctx.reply(`Omega Wolf is the free default rank.`, {
      reply_markup: new InlineKeyboard().text("🐺 Plans", "plan:menu"),
    });
  }

  const durationTier = p.durations[days];
  const priceUsdt = durationTier.priceUsdt;
  const priceRaw = parseUsdt(priceUsdt.toString());

  // 1. Check USDT balance
  const balances = await getLedgerBalances(user.id);
  if (balances.USDT < priceRaw) {
    const have = fmtUsdt(balances.USDT);
    return ctx.reply(
      `❌ <b>Insufficient USDT Balance</b>\n\n` +
      `Subscribing to <b>${escapeHtml(p.displayName)}</b> for <b>${days} days</b> costs <b>${priceUsdt} USDT</b>.\n` +
      `Your current balance: <b>${have} USDT</b>\n\n` +
      `💳 Please deposit at least <b>${priceUsdt} USDT</b> to your bot wallet, then try again.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("💳 Deposit USDT", "deposit")
          .row()
          .text("🐺 Back to plans", "plan:menu"),
      },
    );
  }

  // 2. Deduct USDT balance via ledger
  try {
    await applyLedger({
      userId: user.id,
      asset: "USDT",
      deltaRaw: -priceRaw,
      reason: `plan_subscription_${key.toLowerCase()}_${days}d`,
      refId: `${key}_${days}d_${Date.now()}`,
    });
  } catch (err: any) {
    return ctx.reply(`❌ Payment failed: ${err.message ?? "insufficient funds"}. Please tap /balance.`);
  }

  // 3. Update subscription expiration date
  const now = Date.now();
  const currentExpiry =
    user.planType === key && user.planEndDate && new Date(user.planEndDate).getTime() > now
      ? new Date(user.planEndDate).getTime()
      : now;
  const endDate = new Date(currentExpiry + days * 86_400_000);

  await db.user.update({
    where: { id: user.id },
    data: { planType: key, planEndDate: endDate },
  });
  ctx.user.planType = key;
  ctx.user.planEndDate = endDate;

  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "plan_subscribed",
      meta: {
        plan: key,
        priceUsdt: priceUsdt.toString(),
        durationDays: days,
        endDate: endDate.toISOString(),
      },
    },
  });

  let body = `🎉 <b>Payment Confirmed!</b>\n\n`;
  body += `You are now subscribed to <b>${escapeHtml(p.displayName)}</b>!\n\n`;
  body += `💰 <b>Paid:</b> ${priceUsdt} USDT\n`;
  body += `⏳ <b>Duration:</b> ${days} days\n`;
  body += `📅 <b>Active until:</b> ${endDate.toLocaleDateString()}\n`;
  body += `🎯 <b>Potential ROI:</b> ${escapeHtml(p.roiRange)}\n`;
  body += `📊 <b>Daily picks:</b> ${p.maxPicksPerDay} coin picks/day\n\n`;
  body += `Tap below to see your coin pick for today.`;

  return ctx.reply(body, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("🔍 Get my pick", "bestcoin")
      .row()
      .text("🐺 Plans", "plan:menu")
      .text("🏠 Main menu", "menu"),
  });
});

bot.command("wallet", async (ctx) => {
  if (!ctx.user.wallet) {
    return ctx.reply(
      `💼 <b>You don't have a wallet yet</b>\n\n` +
        `No problem — I'll create one for you for free. Tap below to set it up and get your deposit address.`,
      { parse_mode: "HTML", reply_markup: depositKeyboard(null) },
    );
  }
  const w = await ensureWallet(ctx.user.id); // backfills EVM for legacy wallets
  await ctx.reply(
    `💼 <b>Your wallet addresses</b>\n\n` +
      `These are your personal addresses. Share them to receive funds.\n\n` +
      `🟡 <b>Solana</b> (for SOL and Solana tokens):\n<code>${w.address}</code>\n\n` +
      `🟢 <b>USDT</b> (${escapeHtml(env.EVM_USDT_NETWORK)} network):\n<code>${w.evmAddress}</code>\n\n` +
      `⚠️ Only send funds on the network shown next to each address.`,
    { parse_mode: "HTML", reply_markup: depositKeyboard(w) },
  );
});

async function sendBalance(ctx: Ctx) {
  if (!ctx.user.wallet) {
    return ctx.reply(
      `💰 <b>Your balance is empty</b>\n\n` +
        `Deposit some funds first and I'll show your balance here.`,
      { parse_mode: "HTML", reply_markup: depositKeyboard(null) },
    );
  }
  const b = await getLedgerBalances(ctx.user.id);
  await ctx.reply(
    `💰 <b>Your balance</b>\n\n` +
      `◎ <b>SOL:</b> ${fmtSol(b.SOL)}\n` +
      `🟢 <b>USDT</b> (${escapeHtml(env.EVM_USDT_NETWORK)}): ${fmtUsdt(b.USDT)}\n` +
      `◆ <b>${escapeHtml(env.EVM_GAS_SYMBOL)}</b> (gas): ${fmtEvmNative(b.BNB)}\n\n` +
      `This is the money available for copying trades. Tap below to add more or withdraw.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("💳 Deposit", "deposit")
        .text("💸 Withdraw", "withdraw")
        .row()
        .text("⬅️ Main menu", "menu"),
    },
  );
}
bot.command("balance", sendBalance);
bot.callbackQuery("balance", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await sendBalance(ctx);
});

async function sendDeposit(ctx: Ctx) {
  const w = await ensureWallet(ctx.user.id);
  await ctx.reply(
    `💳 <b>Add funds</b>\n\n` +
      `<b>How to deposit:</b>\n` +
      `1️⃣ Choose a coin and network below\n` +
      `2️⃣ Copy the matching address\n` +
      `3️⃣ Send funds from your exchange or wallet\n` +
      `4️⃣ I'll message you as soon as it arrives ✅\n\n` +
      `🟡 <b>SOL — Solana network</b>\n<code>${w.address}</code>\n\n` +
      `🟢 <b>USDT — ${escapeHtml(env.EVM_USDT_NETWORK)} network</b>\n<code>${w.evmAddress}</code>\n\n` +
      `⚠️ <b>Important:</b> only send each coin on the network shown. Funds sent on the wrong network can be lost.\n` +
      `💡 This address is yours and stays the same. You can deposit as many times as you like.`,
    { parse_mode: "HTML", reply_markup: depositKeyboard(w) },
  );
}
bot.command("deposit", sendDeposit);
bot.callbackQuery("deposit", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await sendDeposit(ctx);
});

// Lazy-create the wallet on first copy tap, then hand back one-tap copy buttons.
bot.callbackQuery(/^copy:(sol|evm)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await sendDeposit(ctx);
});

/* ------------------------ /trading ----------------------- */

async function sendTradingStatus(ctx: Ctx) {
  await enforcePlanExpiry(ctx);
  const user = ctx.user;
  const isSubscriber = user.planType !== "OMEGA" && user.planEndDate && new Date(user.planEndDate).getTime() > Date.now();

  // Also check if user has active copy trades
  const hasActiveCopies = await db.follow.findFirst({
    where: { userId: user.id, active: true },
  });
  const isActiveTrader = isSubscriber || !!hasActiveCopies;

  let text: string;
  if (isActiveTrader) {
    text = await generateSubscriberTradingStatus(user.id);
  } else {
    text = await generateNonSubscriberTradingStatus();
  }

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: getTradingStatusKeyboard(isActiveTrader),
  });
}

bot.command("trading", sendTradingStatus);

bot.callbackQuery("trading", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return sendTradingStatus(ctx);
});

bot.callbackQuery("trading:refresh", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return sendTradingStatus(ctx);
});
