import { InlineKeyboard } from "grammy";
import { PublicKey } from "@solana/web3.js";

/** Escape user-controlled text before interpolating it into an HTML message. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The home menu — every screen ends here so nobody gets stuck. */
export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("💳 Deposit", "deposit")
    .text("💰 Balance", "balance")
    .row()
    .text("📈 Copy a trader", "copytrade")
    .text("🔍 Free coin pick", "bestcoin")
    .row()
    .text("📊 Trading Status", "trading")
    .text("🐺 Plans", "plan:menu")
    .row()
    .text("❓ How it works", "help");
}

/**
 * Deposit copy buttons, shown on the welcome screen.
 * If the wallet already exists we use native copy_text buttons (one tap to copy);
 * otherwise the buttons create the wallet on first tap, then reveal the addresses.
 */
export function depositKeyboard(w?: { address: string; evmAddress: string | null } | null) {
  const kb = new InlineKeyboard();
  if (w?.address && w.evmAddress) {
    kb.copyText("🟡 Copy Solana address", w.address)
      .row()
      .copyText("🟢 Copy USDT address", w.evmAddress)
      .row();
  } else {
    kb.text("🟡 Show Solana address", "copy:sol").row().text("🟢 Show USDT address", "copy:evm").row();
  }
  return kb.text("⬅️ Main menu", "menu");
}

export function isAddress(s: string) {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}

/** Asset picker shown by /withdraw. */
export function withdrawAssetKeyboard() {
  return new InlineKeyboard()
    .text("◎ SOL (Solana)", "wd:asset:SOL")
    .row()
    .text("🟢 USDT (BEP-20)", "wd:asset:USDT")
    .row()
    .text("◆ BNB (gas)", "wd:asset:BNB")
    .row()
    .text("❌ Cancel", "withdraw:cancel");
}

export function shortMint(mint: string) {
  return `${mint.slice(0, 6)}…`;
}

export function followKeyboard(f: {
  id: string;
  active: boolean;
  paper: boolean;
  buyLamports: bigint;
  maxLamports: bigint;
  slippageBps: number;
}) {
  return new InlineKeyboard()
    .text(f.active ? "⏸ Pause copying" : "▶️ Start copying", `ct:toggle:${f.id}`)
    .row()
    .text(f.paper ? "💵 Use real funds" : "🧪 Back to practice mode", `ct:mode:${f.id}`)
    .row()
    .text("0.02 SOL", `ct:amt:${f.id}:20000000`)
    .text("0.05 SOL", `ct:amt:${f.id}:50000000`)
    .text("0.1 SOL", `ct:amt:${f.id}:100000000`)
    .row()
    .text("🗑 Stop copying", `ct:del:${f.id}`);
}

export function followText(f: { trader: { address: string } }) {
  return (
    `🚀 <b>Copying this trader</b>\n\n` +
    `<code>${f.trader.address}</code>\n\n` +
    `When this trader buys or sells, I'll do the same in your account.\n\n` +
    `⏳ Your copy is being set up. You'll get a message as soon as it goes live.`
  );
}

/** Shown once the operator confirms a follow is live; edits the in-progress notice in place. */
export const tradingText = (address: string) =>
  `✅ <b>Copying is live</b>\n\n` +
  `Trader: <code>${address}</code>\n\n` +
  `Every buy and sell they make is copied for you.\n` +
  `Use the buttons below to pause, change your trade size, or stop anytime.`;

export const processingText = "⏳ <b>Setting up your copy...</b>";
