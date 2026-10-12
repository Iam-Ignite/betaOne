import { Api } from "grammy";

let _api: Api | null = null;

function api(): Api {
  if (!_api) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    _api = new Api(token);
  }
  return _api;
}

/** Send an HTML message to a user. Never throws: users may have blocked the bot. */
export async function notify(telegramId: bigint | number, html: string) {
  try {
    await api().sendMessage(Number(telegramId), html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    console.error("notify failed", e);
  }
}

/** Send an ops alert to the admin chat (if configured). Never throws. */
export async function notifyAdmin(html: string) {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  try {
    await api().sendMessage(chatId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    console.error("notifyAdmin failed", e);
  }
}
