import { InlineKeyboard } from "grammy";
import { PublicKey } from "@solana/web3.js";
import { fmtSol } from "@copytrade/core";

/** Escape user-controlled text before interpolating it into an HTML message. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Deposit copy buttons, shown on the welcome screen.
 * If the wallet already exists we use native copy_text buttons (one tap to copy);
 * otherwise the buttons create the wallet on first tap, then reveal the addresses.
 */
export function depositKeyboard(w?: { address: string; evmAddress: string | null } | null) {
  const kb = new InlineKeyboard();
  if (w?.address && w.evmAddress) {
    return kb
      .copyText("🟡 Copy Solana Address", w.address)
      .row()
      .copyText("🟢 Copy USDT Address", w.evmAddress);
  }
  return kb
    .text("🟡 Copy Solana Address", "copy:sol")
    .row()
    .text("🟢 Copy USDT Address", "copy:evm");
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
    .text("◆ BNB (gas)", "wd:asset:BNB");
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
    .text(f.active ? "⏸ Pause" : "▶️ Start", `ct:toggle:${f.id}`)
    .row()
    .text(f.paper ? "📝 Paper: ON → go live" : "💵 LIVE → back to paper", `ct:mode:${f.id}`)
    .row()
    .text("0.02", `ct:amt:${f.id}:20000000`)
    .text("0.05", `ct:amt:${f.id}:50000000`)
    .text("0.1", `ct:amt:${f.id}:100000000`)
    .row()
    .text("🗑 Unfollow", `ct:del:${f.id}`);
}

export function followText(f: {
  trader: { label: string; address: string };
  paper: boolean;
  buyLamports: bigint;
  maxLamports: bigint;
  slippageBps: number;
  active: boolean;
}) {
  return (
    `<b>${f.trader.label}</b>\n<code>${f.trader.address}</code>\n\n` +
    `Mode: ${f.paper ? "📝 paper" : "💵 LIVE"}\n` +
    `Buy size: ${fmtSol(f.buyLamports)} SOL (max ${fmtSol(f.maxLamports)})\n` +
    `Slippage: ${f.slippageBps / 100}%\nStatus: ${f.active ? "🟢 on" : "⚪️ off"}`
  );
}
