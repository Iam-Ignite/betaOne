import { Bot, type Context } from "grammy";
import { db, type User, type Wallet } from "@copytrade/core";

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
    user = await db.user.create({
      data: { telegramId: BigInt(ctx.from.id), username: ctx.from.username },
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
