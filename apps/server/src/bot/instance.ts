import { Bot, type Context } from "grammy";
import {
  db,
  Prisma,
  notifyAdmin,
  generateReferralCode,
  type User,
  type Wallet,
} from "@copytrade/core";
import { escapeHtml } from "./ui";

export type Ctx = Context & { user: User & { wallet: Wallet | null } };

export const bot = new Bot<Ctx>(process.env.TELEGRAM_BOT_TOKEN!);

// Best-effort per-user rate limit (serverless is stateless; use Redis at scale).
const hits = new Map<number, { count: number; reset: number }>();
function allow(id: number) {
  const now = Date.now();
  const e = hits.get(id);
  if (!e || now > e.reset) {
    hits.set(id, { count: 1, reset: now + 10_000 });
    return true;
  }
  e.count += 1;
  return e.count <= 20;
}

// Only private chats; never let the bot act inside groups.
bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  if (!allow(ctx.from.id)) return;

  let user = await db.user.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: { wallet: true },
  });
  if (!user) {
    const referralCode = generateReferralCode();
    let referredBy: string | null = null;
    const startText = ctx.message?.text || (ctx.channelPost?.text) || "";
    if (startText.startsWith("/start")) {
      const parts = startText.split(/\s+/);
      const code = parts[1]?.trim();
      if (code && code.length > 0) {
        const referrer = await db.user.findFirst({ where: { referralCode: code } as any });
        if (referrer) {
          referredBy = referrer.id;
        }
      }
    }
    if (!referredBy && (ctx.from as any)?.referral?.id) {
      const ref = (ctx.from as any).referral.id.toString();
      const referrer = await db.user.findFirst({ where: { referralCode: ref } as any });
      if (referrer) {
        referredBy = referrer.id;
      }
    }
    user = await db.user.create({
      data: {
        telegramId: BigInt(ctx.from.id),
        username: ctx.from.username ?? null,
        referralCode,
        referredBy,
        planType: "OMEGA",
        pending: !referredBy ? ({ action: "referral_code" } as any) : undefined,
      },
      include: { wallet: true },
    });
    if (!referredBy) {
      await ctx.reply(
        `👋 <b>Welcome!</b>\n\nDid someone invite you to this bot?\n\nIf yes, please send me their <b>referral code</b>. Otherwise just type <b>skip</b>.`,
        { parse_mode: "HTML" },
      );
    }
  }
  // Wallets are created lazily on first Deposit / Copy-address tap (see wallet.ts),
  // so people who only look around never get a key pair minted.
  if (user.status === "FROZEN") {
    return ctx.reply(
      "⏸ <b>Your account is paused</b>\n\nPlease contact support and we'll help you get back in.",
      { parse_mode: "HTML" },
    );
  }
  // Any slash command abandons a half-finished text step (e.g. typing /help
  // while halfway through a withdrawal) so users never get stuck in a flow.
  if (ctx.message?.text?.startsWith("/") && user.pending) {
    await db.user.update({ where: { id: user.id }, data: { pending: Prisma.DbNull } });
    user = { ...user, pending: null };
  }
  ctx.user = user as User & { wallet: Wallet | null };
  await next();
});

// Surface handler crashes instead of letting them 500 the webhook silently —
// otherwise Telegram just retries and the user sees no reply at all. Also alerts
// the admin chat when TELEGRAM_ADMIN_CHAT_ID is configured.
bot.catch((err) => {
  const { ctx } = err;
  const error = err.error as Error | unknown;
  const cause = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const update = ctx.update as any;
  const updateId = update?.update_id ?? "unknown";
  console.error(`[bot] error handling update ${updateId}:`, cause);
  const who = ctx.from ? `user ${ctx.from.id}` : "an unknown user";
  notifyAdmin(`⚠️ <b>Bot error</b> for ${who}\n<pre>${escapeHtml(cause).slice(0, 800)}</pre>`).catch(() => {});
  try {
    if (ctx.callbackQuery) {
      ctx.answerCallbackQuery().catch(() => {});
    }
    ctx.reply("⚠️ Something went wrong. Please try again.").catch(() => {});
  } catch {}
});
