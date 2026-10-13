import { bot, type Ctx } from "./instance";
import { fmtSol, fmtUsdt, fmtEvmNative, getLedgerBalances, env } from "@copytrade/core";
import { depositKeyboard, escapeHtml } from "./ui";
import { ensureWallet } from "./wallet";

export const COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "wallet", description: "View wallet addresses" },
  { command: "balance", description: "Check your balance" },
  { command: "deposit", description: "Fund your wallet" },
  { command: "withdraw", description: "Withdraw funds" },
  { command: "copytrade", description: "Start copytrading" },
  { command: "cancel", description: "Cancel current operation" },
  { command: "help", description: "Get help" },
];

function greeting(ctx: Ctx) {
  const u = ctx.from;
  if (u?.username) return `@${u.username}`;
  return escapeHtml(u?.first_name || "there");
}

bot.command("start", (ctx) => {
  const w = ctx.user.wallet;
  const evmLabel = escapeHtml(env.EVM_USDT_NETWORK);
  let body =
    `🚀 <b>Welcome to Primecopytradebot</b> 🚀\n\n` +
    `Hello ${greeting(ctx)}! Welcome to our advanced copytrading platform.`;

  if (w?.address && w.evmAddress) {
    body +=
      `\n\nYour deposit addresses:\n` +
      `🟡 <b>Solana:</b> <code>${w.address}</code>\n` +
      `🟢 <b>USDT</b> (${evmLabel}): <code>${w.evmAddress}</code>`;
  }
  body += `\n\n👇 Click below to copy deposit addresses:`;
  return ctx.reply(body, { parse_mode: "HTML", reply_markup: depositKeyboard(w) });
});

bot.command("help", (ctx) =>
  ctx.reply(
    "<b>Commands</b>\n" +
      COMMANDS.map((c) => `/${c.command} — ${escapeHtml(c.description)}`).join("\n"),
    { parse_mode: "HTML" },
  ),
);

bot.command("wallet", async (ctx) => {
  if (!ctx.user.wallet) {
    return ctx.reply("You don't have a wallet yet. Create it when you fund your account below.", {
      parse_mode: "HTML",
      reply_markup: depositKeyboard(null),
    });
  }
  const w = await ensureWallet(ctx.user.id); // backfills EVM for legacy wallets
  await ctx.reply(
    `Your wallets:\n🟡 <b>Solana:</b> <code>${w.address}</code>\n` +
      `🟢 <b>USDT</b> (${escapeHtml(env.EVM_USDT_NETWORK)}): <code>${w.evmAddress}</code>`,
    { parse_mode: "HTML" },
  );
});

async function sendBalance(ctx: Ctx) {
  if (!ctx.user.wallet) {
    return ctx.reply("No wallet yet. Create it when you fund your account below.", {
      parse_mode: "HTML",
      reply_markup: depositKeyboard(null),
    });
  }
  const b = await getLedgerBalances(ctx.user.id);
  await ctx.reply(
    `<b>Account balance</b>\n\n` +
      `◎ <b>SOL:</b> ${fmtSol(b.SOL)}\n` +
      `🟢 <b>USDT</b> (${escapeHtml(env.EVM_USDT_NETWORK)}): ${fmtUsdt(b.USDT)}\n` +
      `◆ <b>${escapeHtml(env.EVM_GAS_SYMBOL)}</b>: ${fmtEvmNative(b.BNB)}`,
    { parse_mode: "HTML" },
  );
}
bot.command("balance", sendBalance);
bot.callbackQuery("balance", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendBalance(ctx);
});

async function sendDeposit(ctx: Ctx) {
  const w = await ensureWallet(ctx.user.id);
  await ctx.reply(
    `📥 <b>Fund your wallet</b>\n\n` +
      `🟡 <b>Solana</b> — send SOL on the Solana network:\n<code>${w.address}</code>\n\n` +
      `🟢 <b>USDT</b> (${escapeHtml(env.EVM_USDT_NETWORK)}):\n<code>${w.evmAddress}</code>\n\n` +
      `⚠️ Only send on the matching network; wrong-network funds are lost. ` +
      `I'll message you when a deposit arrives.`,
    { parse_mode: "HTML", reply_markup: depositKeyboard(w) },
  );
}
bot.command("deposit", sendDeposit);
bot.callbackQuery("deposit", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendDeposit(ctx);
});

// Lazy-create the wallet on first copy tap, then hand back one-tap copy buttons.
bot.callbackQuery(/^copy:(sol|evm)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendDeposit(ctx);
});
