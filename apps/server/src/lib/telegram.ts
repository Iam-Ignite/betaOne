import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

/**
 * Validate Telegram Mini App initData on the server. Never trust the user id the
 * page sends; always derive it from the validated payload.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 3600,
): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  if (!hash) return null;

  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest("hex");
  if (calc.length !== hash.length || !timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) {
    return null;
  }
  const authDate = Number(params.get("auth_date") ?? 0);
  if (Date.now() / 1000 - authDate > maxAgeSec) return null;

  const user = params.get("user");
  if (!user) return null;
  return JSON.parse(user) as TelegramUser;
}
