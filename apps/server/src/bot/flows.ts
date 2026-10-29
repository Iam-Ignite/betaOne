import { InlineKeyboard } from "grammy";
import { hash, verify } from "argon2";
import { bot, type Ctx } from "./instance";
import {
  db,
  Prisma,
  fmtSol,
  fmtUsdt,
  fmtEvmNative,
  parseUnits,
  evmUsdtDecimals,
  getLedgerBalances,
  applyLedger,
  isEvmAddress,
  notify,
} from "@copytrade/core";
import {
  followKeyboard,
  followText,
  processingText,
  tradingText,
  isAddress,
  withdrawAssetKeyboard,
  escapeHtml,
} from "./ui";

type Pending = Record<string, unknown> | null;

type Asset = "SOL" | "USDT" | "BNB";

type FlowState = {
  action?: string;
  step?: string;
  asset?: Asset;
  to?: string;
  amountRaw?: string;
};

/** Per-asset withdrawal rules. Amounts are in the asset's raw units. */
const ASSET_META: Record<
  Asset,
  {
    label: string;
    kind: "sol" | "evm";
    decimals: number;
    gasReserve: bigint;
    unit: string;
    fmt: (raw: bigint) => string;
  }
> = {
  SOL: {
    label: "SOL (Solana)",
    kind: "sol",
    decimals: 9,
    gasReserve: 0n, // the operator pays network fees from the pooled wallet
    unit: "SOL",
    fmt: (r) => `${fmtSol(r)} SOL`,
  },
  USDT: {
    label: "USDT (BEP-20)",
    kind: "evm",
    decimals: evmUsdtDecimals(),
    gasReserve: 0n,
    unit: "USDT",
    fmt: (r) => `${fmtUsdt(r)} USDT`,
  },
  BNB: {
    label: "BNB (gas)",
    kind: "evm",
    decimals: 18,
    gasReserve: 0n,
    unit: "BNB",
    fmt: (r) => `${fmtEvmNative(r)} BNB`,
  },
};

const setPending = (id: string, pending: Pending) =>
  db.user.update({
    where: { id },
    data: { pending: pending === null ? Prisma.DbNull : (pending as Prisma.InputJsonValue) },
  });

/* ------------------------ /withdraw ------------------------ */

async function startWithdraw(ctx: Ctx) {
  if (!ctx.user.pinHash) {
    await setPending(ctx.user.id, { action: "set_pin" });
    return ctx.reply(
      `🔐 <b>Quick safety step</b>\n\n` +
        `Before you can withdraw, please set a <b>4–8 digit PIN</b>. You'll enter it each time you send funds, so nobody else can move your money.\n\n` +
        `✍️ Type your PIN now. I'll delete your message right after for safety.`,
      { parse_mode: "HTML" },
    );
  }
  await setPending(ctx.user.id, { action: "withdraw", step: "asset" });
  return ctx.reply(
    `💸 <b>Withdraw funds</b>\n\n` +
      `Choose which coin you want to send. I'll then ask for your destination address and the amount.\n\n` +
      `💡 Withdrawals go back to your own wallet or exchange.`,
    { parse_mode: "HTML", reply_markup: withdrawAssetKeyboard() },
  );
}

bot.command("withdraw", startWithdraw);
bot.callbackQuery("withdraw", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return ctx.reply("Ready to withdraw? Tap below to begin.", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("💸 Start withdrawal", "withdraw:start")
      .row()
      .text("⬅️ Main menu", "menu"),
  });
});
bot.callbackQuery("withdraw:start", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return startWithdraw(ctx);
});
bot.callbackQuery("withdraw:cancel", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await setPending(ctx.user.id, null);
  return ctx.reply("✅ Withdrawal cancelled. Nothing was sent.");
});

bot.callbackQuery(/^wd:asset:(SOL|USDT|BNB)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const asset = ctx.match[1] as Asset;
  await setPending(ctx.user.id, { action: "withdraw", step: "address", asset });
  const meta = ASSET_META[asset];
  return ctx.reply(
    meta.kind === "sol"
      ? `📍 <b>Step 2 of 3 — Destination address</b>\n\n` +
          `Send the <b>Solana wallet address</b> you want to receive the ${meta.unit}.\n\n` +
          `💡 You can copy it from your exchange's "Deposit" screen or from your own wallet. It usually starts with a letter or number and is about 44 characters long.\n\n` +
          `Send it here, or tap /cancel to stop.`
      : `📍 <b>Step 2 of 3 — Destination address</b>\n\n` +
          `Send the <b>${meta.label}</b> wallet address you want to receive the ${meta.unit}.\n\n` +
          `💡 It starts with <code>0x</code> and is 42 characters long. You can copy it from your exchange's "Deposit" screen.\n\n` +
          `Send it here, or tap /cancel to stop.`,
    { parse_mode: "HTML" },
  );
});

bot.command("cancel", async (ctx) => {
  await setPending(ctx.user.id, null);
  return ctx.reply("✅ Cancelled. Nothing was sent. Tap /start to see the main menu.");
});

/* --------------------- text-based flows -------------------- */

bot.on("message:text", async (ctx, next) => {
  const p = ctx.user.pending as FlowState | null;
  if (!p) return next();
  const text = ctx.message.text.trim();

  if ((p as any).action === "referral_code") {
    try {
      await ctx.deleteMessage();
    } catch {}
    if (text.toLowerCase() === "skip" || text === "-") {
      await setPending(ctx.user.id, null);
      ctx.user.pending = null;
      return ctx.reply(
        `✅ Got it. You can always use /refer to share your own code later.`,
        { parse_mode: "HTML", reply_markup: (await import("./ui")).mainMenuKeyboard() },
      );
    }
    const referrer = await db.user.findFirst({ where: { referralCode: text } as any });
    if (!referrer) {
      return ctx.reply(
        `❌ Invalid referral code.\n\nPlease try again or type <b>skip</b> to continue without one.`,
        { parse_mode: "HTML" },
      );
    }
    if (referrer.id === ctx.user.id) {
      await setPending(ctx.user.id, null);
      ctx.user.pending = null;
      return ctx.reply(`You can't use your own referral code.`, { parse_mode: "HTML", reply_markup: (await import("./ui")).mainMenuKeyboard() });
    }
    await db.user.update({ where: { id: ctx.user.id }, data: { referredBy: referrer.id, pending: Prisma.DbNull } });
    ctx.user.referredBy = referrer.id;
    ctx.user.pending = null;
    await notify(
      referrer.telegramId,
      `🎉 <b>New referral!</b>\n\nSomeone joined using your invite code.`,
    ).catch(() => {});
    return ctx.reply(
      `🎉 <b>Referral applied!</b>\n\nYou'll be connected to your inviter. Your inviter will earn 5% of your successful trade profits.`,
      { parse_mode: "HTML", reply_markup: (await import("./ui")).mainMenuKeyboard() },
    );
  }

  if (p.action === "set_pin") {
    await ctx.deleteMessage().catch(() => {});
    if (!/^\d{4,8}$/.test(text)) {
      return ctx.reply(
        "Your PIN must be <b>4–8 numbers</b> (for example 1234). Please type it again, or tap /cancel.",
        { parse_mode: "HTML" },
      );
    }
    await db.user.update({
      where: { id: ctx.user.id },
      data: { pinHash: await hash(text), pending: Prisma.DbNull },
    });
    ctx.user.pinHash = "set";
    return startWithdraw(ctx);
  }

  if (p.action === "withdraw") {
    const asset: Asset = p.asset ?? "SOL";
    const meta = ASSET_META[asset];
    if (p.step === "address") {
      const ok = meta.kind === "sol" ? isAddress(text) : isEvmAddress(text);
      if (!ok) {
        return ctx.reply(
          `❌ That doesn't look like a valid ${meta.kind === "sol" ? "Solana" : "BEP-20"} address.\n\n` +
            `Please check it and send it again, or tap /cancel to stop.`,
        );
      }
      await setPending(ctx.user.id, { action: "withdraw", step: "amount", asset, to: text });
      const balances = await getLedgerBalances(ctx.user.id);
      const bal = balances[asset];
      return ctx.reply(
        `✅ Address saved.\n\n` +
          `💰 <b>Step 3 of 3 — How much?</b>\n\n` +
          `How much <b>${meta.unit}</b> would you like to send?\n` +
          `• Type a number, for example <code>0.5</code>\n` +
          `• Or type <code>max</code> to send everything\n\n` +
          `💡 Available to withdraw: <b>${meta.fmt(bal)}</b>`,
        { parse_mode: "HTML" },
      );
    }
    if (p.step === "amount") {
      const balances = await getLedgerBalances(ctx.user.id);
      const bal = balances[asset];

      let raw: bigint;
      if (text.toLowerCase() === "max") {
        raw = bal;
      } else {
        try {
          raw = parseUnits(text, meta.decimals);
        } catch {
          return ctx.reply(
            `❌ Please send a number, like <code>0.5</code>, or type <code>max</code>.`,
            { parse_mode: "HTML" },
          );
        }
        if (raw <= 0n) {
          return ctx.reply(`❌ Please send an amount greater than zero, or type <code>max</code>.`, {
            parse_mode: "HTML",
          });
        }
      }
      if (raw <= 0n || raw > bal) {
        return ctx.reply(
          `❌ You don't have enough ${meta.unit}.\n\nAvailable: <b>${meta.fmt(bal)}</b>\nTry a smaller amount or type <code>max</code>.`,
          { parse_mode: "HTML" },
        );
      }
      await setPending(ctx.user.id, {
        action: "withdraw",
        step: "pin",
        asset,
        to: p.to,
        amountRaw: raw.toString(),
      });
      return ctx.reply(
        `🔎 <b>Please confirm</b>\n\n` +
          `You're sending <b>${meta.fmt(raw)}</b>\n` +
          `To: <code>${escapeHtml(p.to as string)}</code>\n\n` +
          `Enter your PIN to confirm. I'll delete your PIN message for safety.\n` +
          `Tap /cancel if anything looks wrong.`,
        { parse_mode: "HTML" },
      );
    }
    if (p.step === "pin") {
      await ctx.deleteMessage().catch(() => {});
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!(await verify(user.pinHash!, text))) {
        return ctx.reply(
          "❌ That PIN is incorrect. Please try again, or tap /cancel to stop.",
        );
      }
      const raw = BigInt(p.amountRaw as string);
      const to = p.to as string;

      const wd = await db.withdrawal.create({
        data: { userId: user.id, asset, toAddress: to, amountRaw: raw },
      });
      try {
        await applyLedger({
          userId: user.id,
          asset,
          deltaRaw: -raw,
          reason: "withdraw_request",
          refId: wd.id,
        });
      } catch {
        await db.withdrawal.update({
          where: { id: wd.id },
          data: { status: "FAILED", error: "insufficient balance" },
        });
        await setPending(user.id, null);
        return ctx.reply(
          `❌ You don't have enough ${meta.unit}. Nothing was sent.\n\nTap /balance to check your balance.`,
        );
      }
      await db.auditLog.create({
        data: { userId: user.id, action: "withdraw_requested", meta: { asset, to, amountRaw: p.amountRaw } },
      });
      await setPending(user.id, null);
      return ctx.reply(
        `✅ <b>Withdrawal requested</b>\n\n` +
          `Amount: <b>${meta.fmt(raw)}</b>\n` +
          `To: <code>${escapeHtml(to)}</code>\n\n` +
          `Your withdrawal is now being processed. I'll update you here.\n\n` +
          `Tap /balance anytime to check your funds.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("💰 Balance", "balance").row().text("🏠 Main menu", "menu"),
        },
      );
    }
  }

  if (p.action === "follow_address") {
    if (!isAddress(text)) {
      return ctx.reply(
        `❌ That doesn't look like a Solana wallet address.\n\n` +
          `A Solana address is usually about 44 characters long and starts with a letter or number.\n\n` +
          `Please copy it again and send it here, or tap /cancel to stop.`,
      );
    }
    const trader = await db.trader.upsert({
      where: { address: text },
      update: {},
      create: { address: text, label: text },
    });
    const f = await db.follow.upsert({
      where: { userId_traderId: { userId: ctx.user.id, traderId: trader.id } },
      update: { active: true },
      create: { userId: ctx.user.id, traderId: trader.id, active: true },
    });
    await setPending(ctx.user.id, null);
    await markHeliusDirty();
    const sent = await ctx.reply(processingText, { parse_mode: "HTML" });
    await ctx.api.editMessageText(sent.chat.id, sent.message_id, followText({ trader }), {
      parse_mode: "HTML",
    });
    await db.follow.update({
      where: { id: f.id },
      data: { statusMessageId: BigInt(sent.message_id) },
    });
    return;
  }

  return next();
});

/* ------------------------ /copytrade ----------------------- */

const COPY_INTRO =
  `📈 <b>Copy a trader</b>\n\n` +
  `Copy trading means automatically repeating someone else's trades. When they buy, I buy for you. When they sell, I sell for you.\n\n` +
  `<b>What you need:</b>\n` +
  `A <b>Solana wallet address</b> of the trader you want to copy. This is public — you can find it on a block explorer or ask the trader to share it.\n\n` +
  `<b>How to start:</b>\n` +
  `1️⃣ Tap <b>Paste trader address</b>\n` +
  `2️⃣ Send their wallet address\n` +
  `3️⃣ Choose how much to spend per trade\n` +
  `4️⃣ I'll do the rest automatically\n\n` +
  `💡 Not sure? Start in <b>practice mode</b> — it uses virtual money, not real funds.`;

function copyIntroKeyboard() {
  return new InlineKeyboard()
    .text("📋 Paste trader address", "ct:add")
    .row()
    .text("❓ What is a wallet address?", "ct:help")
    .row()
    .text("⬅️ Main menu", "menu");
}

bot.command("copytrade", async (ctx) => {
  await setPending(ctx.user.id, null);
  return ctx.reply(COPY_INTRO, { parse_mode: "HTML", reply_markup: copyIntroKeyboard() });
});

bot.callbackQuery("copytrade", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await setPending(ctx.user.id, null);
  return ctx.reply(COPY_INTRO, { parse_mode: "HTML", reply_markup: copyIntroKeyboard() });
});

bot.callbackQuery("ct:help", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  return ctx.reply(
    `🔎 <b>What is a wallet address?</b>\n\n` +
      `A wallet address is a public ID for a crypto account — like a bank account number. It's safe to share; it only lets people send funds to it, not take funds out.\n\n` +
      `For Solana it looks like a long mix of letters and numbers, about 44 characters long.\n\n` +
      `You can find a trader's address by asking them for it, or by opening their profile on a block explorer like Solscan.\n\n` +
      `<b>Never share your PIN or private keys with anyone.</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("📋 I have an address", "ct:add")
        .row()
        .text("⬅️ Main menu", "menu"),
    },
  );
});

bot.callbackQuery("ct:add", async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await setPending(ctx.user.id, { action: "follow_address" });
  await ctx.reply(
    `📋 <b>Paste the trader's address</b>\n\n` +
      `Send the <b>Solana wallet address</b> you want to copy.\n\n` +
      `💡 Tip: copy it from their profile and paste it here. Send /cancel if you change your mind.`,
    { parse_mode: "HTML" },
  );
});

bot.callbackQuery(/^ct:follow:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const traderId = ctx.match[1];
  const f = await db.follow.upsert({
    where: { userId_traderId: { userId: ctx.user.id, traderId } },
    update: {},
    create: { userId: ctx.user.id, traderId },
  });
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:open:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  await showFollow(ctx, ctx.match[1]);
});

async function ownedFollow(ctx: Ctx, id: string) {
  const f = await db.follow.findUnique({ where: { id }, include: { trader: true } });
  if (!f || f.userId !== ctx.user.id) return null; // ALWAYS verify ownership
  return f;
}

async function showFollow(ctx: Ctx, followId: string) {
  const f = await db.follow.findUniqueOrThrow({ where: { id: followId }, include: { trader: true } });
  // Controls stay hidden until the operator confirms trading has started.
  if (f.startedAt === null) {
    return ctx.reply(followText({ trader: f.trader }), { parse_mode: "HTML" });
  }
  await ctx.reply(tradingText(f.trader.address), {
    parse_mode: "HTML",
    reply_markup: followKeyboard(f),
  });
}

bot.callbackQuery(/^ct:toggle:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) { try { await ctx.answerCallbackQuery("Not found."); } catch {} return; }
  await db.follow.update({ where: { id: f.id }, data: { active: !f.active } });
  await markHeliusDirty();
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:mode:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) { try { await ctx.answerCallbackQuery("Not found."); } catch {} return; }
  if (f.paper) {
    return ctx.reply(
      `⚠️ <b>Switch to real money?</b>\n\n` +
        `Practice mode uses virtual funds. Switching to <b>real funds</b> means trades will use money from your balance.\n\n` +
        `Only continue if you understand the risk.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, use real funds", `ct:live:${f.id}`)
          .row()
          .text("❌ Stay in practice mode", `ct:open:${f.id}`),
      },
    );
  }
  await db.follow.update({ where: { id: f.id }, data: { paper: true } });
  await ctx.reply("🧪 Switched to practice mode. Trades now use virtual money.");
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:live:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) { try { await ctx.answerCallbackQuery("Not found."); } catch {} return; }
  if (process.env.LIVE_TRADING_ALLOWED !== "true" && process.env.SIMULATE_TRADING !== "true") {
    return ctx.reply(
      "⚠️ Real-money trading isn't available on this bot yet. You can keep practicing with virtual funds.",
    );
  }
  await db.follow.update({ where: { id: f.id }, data: { paper: false } });
  await ctx.reply(
    `💵 <b>Real-money trading is on</b>\n\nTrades will now use funds from your balance. You can switch back to practice mode anytime.`,
  );
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:amt:(.+):(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) { try { await ctx.answerCallbackQuery("Not found."); } catch {} return; }
  const lamports = BigInt(ctx.match[2]);
  await db.follow.update({
    where: { id: f.id },
    data: { buyLamports: lamports, maxLamports: lamports * 2n },
  });
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:del:(.+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {};
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) { try { await ctx.answerCallbackQuery("Not found."); } catch {} return; }
  await db.follow.delete({ where: { id: f.id } });
  await markHeliusDirty();
  await ctx.reply(
    "🗑 <b>Stopped copying this trader.</b>\n\nNo new trades will be copied. Your existing funds and coins stay in your account.",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("📈 Copy another trader", "copytrade")
        .row()
        .text("🏠 Main menu", "menu"),
    },
  );
});

/** Flag the Helius address list as stale so the worker re-syncs it. */
async function markHeliusDirty() {
  await db.setting.upsert({
    where: { key: "helius_dirty" },
    update: { value: "1" },
    create: { key: "helius_dirty", value: "1" },
  });
}
