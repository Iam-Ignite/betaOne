import { bot, type Ctx } from "./instance";
import { mainMenuKeyboard } from "./ui";

const HELP_SUGGESTION =
  `🤔 <b>I'm not sure what you mean.</b>\n\n` +
  `I understand commands like /deposit, /balance, /copytrade and /bestcoin.\n\n` +
  `Tap <b>❓ How it works</b> for a step-by-step guide, or use the buttons below.`;

function suggestionText(ctx: Ctx) {
  const text = ctx.message?.text?.trim() ?? "";
  if (text.startsWith("/")) {
    return (
      `🤔 <b>I don't know that command.</b>\n\n` +
      `Tap <b>❓ How it works</b> to see everything I can do, or pick an option below.`
    );
  }
  return HELP_SUGGESTION;
}

bot.on("message", async (ctx) => {
  await ctx.reply(suggestionText(ctx), {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
});

bot.on("callback_query:data", async (ctx) => {
  try {
    try { await ctx.answerCallbackQuery("This button has expired."); } catch {}
  } catch {}
  try {
    await ctx.reply(
      "🔄 <b>That button is out of date.</b>\n\nNo problem — here's the main menu again.",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
    );
  } catch {}
});
