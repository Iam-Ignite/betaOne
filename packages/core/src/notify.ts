import { Api, type InlineKeyboard } from "grammy";

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
export async function notify(
  telegramId: bigint | number,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  try {
    await api().sendMessage(Number(telegramId), html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    return true;
  } catch (e) {
    console.error("notify failed", e);
    return false;
  }
}

/**
 * Edit an existing message the bot sent. Used to flip a status notice in place
 * (e.g. "in progress" → "live") so it reads as an automated update. Never throws.
 */
export async function editMessage(
  telegramId: bigint | number,
  messageId: bigint | number,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  try {
    await api().editMessageText(Number(telegramId), Number(messageId), html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    return true;
  } catch (e) {
    console.error("editMessage failed", e);
    return false;
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
