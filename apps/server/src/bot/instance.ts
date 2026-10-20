import { Bot, type Context } from "grammy";
import { db, notifyAdmin, type User, type Wallet } from "@copytrade/core";
import { generateReferralCode } from "@copytrade/core";
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
    const referredBy = ctx.from?.referral?.id?.toString();
    user = await db.user.create({
      data: { telegramId: BigInt(ctx.from.id), username: ctx.from.username, referralCode, referredBy, planType: "FREE" },
      include: { wallet: true },
    });
  }
  // Wallets are created lazily on first Deposit / Copy-address tap (see wallet.ts),
  // so people who only look around never get a key pair minted.
  if (user.status === "FROZEN") {
    return ctx.reply("Your account is paused. Contact support.");
  }
  ctx.user = user;
  await next();
});

// Surface handler crashes instead of letting them 500 the webhook silently —
// otherwise Telegram just retries and the user sees no reply at all. Also alerts
// the admin chat when TELEGRAM_ADMIN_CHAT_ID is configured.
bot.catch((err) => {
  const { ctx } = err;
  const cause =
    err.error instanceof Error ? (err.error.stack ?? err.error.message) : String(err.error);
  console.error(`[bot] error handling update ${ctx.update.update_id}:`, err.error);
  const who = ctx.from ? `user ${ctx.from.id}` : "an unknown user";
  notifyAdmin(`⚠️ <b>Bot error</b> for ${who}\n<pre>${escapeHtml(cause).slice(0, 800)}</pre>`);
  // Best-effort reply so the user isn't left staring at nothing.
  ctx.reply("⚠️ Something went wrong. Please try again.").catch(() => {});
});
