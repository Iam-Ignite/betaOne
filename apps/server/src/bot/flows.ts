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
} from "@copytrade/core";
import {
  followKeyboard,
  followText,
  processingText,
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

/** Per-asset withdrawal rules. `dailyLimit` is in the asset's raw units. */
const ASSET_META: Record<
  Asset,
  {
    label: string;
    kind: "sol" | "evm";
    decimals: number;
    gasReserve: bigint;
    dailyLimit: bigint;
    unit: string;
    fmt: (raw: bigint) => string;
  }
> = {
  SOL: {
    label: "SOL (Solana)",
    kind: "sol",
    decimals: 9,
    gasReserve: 0n, // the operator pays network fees from the pooled wallet
    dailyLimit: 5_000_000_000n, // 5 SOL
    unit: "SOL",
    fmt: (r) => `${fmtSol(r)} SOL`,
  },
  USDT: {
    label: "USDT (BEP-20)",
    kind: "evm",
    decimals: evmUsdtDecimals(),
    gasReserve: 0n,
    dailyLimit: parseUnits("10000", evmUsdtDecimals()), // 10,000 USDT
    unit: "USDT",
    fmt: (r) => `${fmtUsdt(r)} USDT`,
  },
  BNB: {
    label: "BNB (gas)",
    kind: "evm",
    decimals: 18,
    gasReserve: 0n,
    dailyLimit: parseUnits("10", 18), // 10 BNB
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

bot.command("withdraw", async (ctx) => {
  if (!ctx.user.pinHash) {
    await setPending(ctx.user.id, { action: "set_pin" });
    return ctx.reply("🔐 First set a withdrawal PIN (4–8 digits). I'll delete your message right after.");
  }
  await setPending(ctx.user.id, { action: "withdraw", step: "asset" });
  return ctx.reply("💸 <b>Withdraw</b>\nChoose the asset to send:", {
    parse_mode: "HTML",
    reply_markup: withdrawAssetKeyboard(),
  });
});
bot.callbackQuery("withdraw", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Use /withdraw to send funds.");
});

bot.callbackQuery(/^wd:asset:(SOL|USDT|BNB)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const asset = ctx.match[1] as Asset;
  await setPending(ctx.user.id, { action: "withdraw", step: "address", asset });
  const meta = ASSET_META[asset];
  return ctx.reply(
    meta.kind === "sol"
      ? "Send the destination <b>Solana address</b>:"
      : `Send the destination <b>${meta.label}</b> address (<code>0x…</code>):`,
    { parse_mode: "HTML" },
  );
});

bot.command("cancel", async (ctx) => {
  await setPending(ctx.user.id, null);
  return ctx.reply("Cancelled.");
});

/* --------------------- text-based flows -------------------- */

bot.on("message:text", async (ctx, next) => {
  const p = ctx.user.pending as FlowState | null;
  if (!p) return next();
  const text = ctx.message.text.trim();

  if (p.action === "set_pin") {
    await ctx.deleteMessage().catch(() => {});
    if (!/^\d{4,8}$/.test(text)) return ctx.reply("PIN must be 4–8 digits. Try again.");
    await db.user.update({
      where: { id: ctx.user.id },
      data: { pinHash: await hash(text), pending: Prisma.DbNull },
    });
    return ctx.reply("✅ PIN saved. Run /withdraw again.");
  }

  if (p.action === "withdraw") {
    const asset: Asset = p.asset ?? "SOL";
    const meta = ASSET_META[asset];
    if (p.step === "address") {
      const ok = meta.kind === "sol" ? isAddress(text) : isEvmAddress(text);
      if (!ok) {
        return ctx.reply(
          `That is not a valid ${meta.kind === "sol" ? "Solana" : "BEP-20"} address. Try again or send /cancel.`,
        );
      }
      await setPending(ctx.user.id, { action: "withdraw", step: "amount", asset, to: text });
      return ctx.reply(`How much <b>${meta.unit}</b>? (number, or <code>max</code>)`, {
        parse_mode: "HTML",
      });
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
          return ctx.reply("Send a positive number.");
        }
        if (raw <= 0n) return ctx.reply("Send a positive number.");
      }
      if (raw <= 0n || raw > bal) {
        return ctx.reply(`Not enough ${meta.unit}.`);
      }
      await setPending(ctx.user.id, {
        action: "withdraw",
        step: "pin",
        asset,
        to: p.to,
        amountRaw: raw.toString(),
      });
      return ctx.reply(
        `Confirm: send <b>${meta.fmt(raw)}</b> to\n<code>${p.to}</code>\n\n` +
          `Enter your PIN to confirm (I'll delete the message), or /cancel.`,
        { parse_mode: "HTML" },
      );
    }
    if (p.step === "pin") {
      await ctx.deleteMessage().catch(() => {});
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!(await verify(user.pinHash!, text))) {
        return ctx.reply("❌ Wrong PIN.");
      }
      const raw = BigInt(p.amountRaw as string);
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      // Prisma's `_sum` cannot aggregate BigInt columns, so total by hand.
      const recent = await db.withdrawal.findMany({
        where: { userId: user.id, asset, status: { not: "FAILED" }, createdAt: { gte: since } },
        select: { amountRaw: true },
      });
      const used = recent.reduce((sum, w) => sum + w.amountRaw, 0n);
      const to = p.to as string;
      if (used + raw > meta.dailyLimit) {
        await setPending(user.id, null);
        return ctx.reply(`Daily ${meta.unit} withdrawal limit reached.`);
      }

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
        return ctx.reply(`Not enough ${meta.unit}.`);
      }
      await db.auditLog.create({
        data: { userId: user.id, action: "withdraw_requested", meta: { asset, to, amountRaw: p.amountRaw } },
      });
      await setPending(user.id, null);
      return ctx.reply(
        `⏳ <b>${meta.fmt(raw)}</b> withdrawal requested.\n\n` +
          `To: <code>${escapeHtml(to)}</code>\n` +
          `Your withdrawal is being processed.`,
        { parse_mode: "HTML" },
      );
    }
  }

  if (p.action === "follow_address") {
    if (!isAddress(text)) {
      return ctx.reply("That is not a valid Solana address. Try again or send /cancel.");
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
      reply_markup: followKeyboard(f),
    });
    return;
  }

  return next();
});

/* ------------------------ /copytrade ----------------------- */

bot.command("copytrade", async (ctx) => {
  await setPending(ctx.user.id, { action: "follow_address" });
  return ctx.reply(
    "📈 <b>Copytrade</b>\n\nEnter the address to copytrade:",
    { parse_mode: "HTML" },
  );
});

bot.callbackQuery("ct:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  await setPending(ctx.user.id, { action: "follow_address" });
  await ctx.reply("Enter the address to copytrade:");
});

bot.callbackQuery(/^ct:follow:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const traderId = ctx.match[1];
  const f = await db.follow.upsert({
    where: { userId_traderId: { userId: ctx.user.id, traderId } },
    update: {},
    create: { userId: ctx.user.id, traderId },
  });
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:open:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showFollow(ctx, ctx.match[1]);
});

async function ownedFollow(ctx: Ctx, id: string) {
  const f = await db.follow.findUnique({ where: { id }, include: { trader: true } });
  if (!f || f.userId !== ctx.user.id) return null; // ALWAYS verify ownership
  return f;
}

async function showFollow(ctx: Ctx, followId: string) {
  const f = await db.follow.findUniqueOrThrow({ where: { id: followId }, include: { trader: true } });
  await ctx.reply(followText(f), {
    parse_mode: "HTML",
    reply_markup: followKeyboard(f),
  });
}

bot.callbackQuery(/^ct:toggle:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) return ctx.answerCallbackQuery("Not found.");
  await db.follow.update({ where: { id: f.id }, data: { active: !f.active } });
  await markHeliusDirty();
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:mode:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) return ctx.answerCallbackQuery("Not found.");
  if (f.paper) {
    return ctx.reply(
      "⚠️ Switching to <b>LIVE</b> trades with real funds. Continue?",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Go live", `ct:live:${f.id}`)
          .text("Cancel", `ct:open:${f.id}`),
      },
    );
  }
  await db.follow.update({ where: { id: f.id }, data: { paper: true } });
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:live:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) return ctx.answerCallbackQuery("Not found.");
  if (process.env.LIVE_TRADING_ALLOWED !== "true" && process.env.SIMULATE_TRADING !== "true") {
    return ctx.reply("Live trading is not enabled on this deployment yet.");
  }
  await db.follow.update({ where: { id: f.id }, data: { paper: false } });
  await ctx.reply("💵 This follow is now LIVE. Trade sizes apply to real funds.");
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:amt:(.+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) return ctx.answerCallbackQuery("Not found.");
  const lamports = BigInt(ctx.match[2]);
  await db.follow.update({
    where: { id: f.id },
    data: { buyLamports: lamports, maxLamports: lamports * 2n },
  });
  await showFollow(ctx, f.id);
});

bot.callbackQuery(/^ct:del:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const f = await ownedFollow(ctx, ctx.match[1]);
  if (!f) return ctx.answerCallbackQuery("Not found.");
  await db.follow.delete({ where: { id: f.id } });
  await markHeliusDirty();
  await ctx.reply("🗑 Unfollowed. The leader's Helius subscription will update shortly.");
});

/** Flag the Helius address list as stale so the worker re-syncs it. */
async function markHeliusDirty() {
  await db.setting.upsert({
    where: { key: "helius_dirty" },
    update: { value: "1" },
    create: { key: "helius_dirty", value: "1" },
  });
}
