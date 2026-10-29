import {
  db,
  getSolBalance,
  fmtSol,
  getUsdtBalanceRaw,
  getEvmNativeBalance,
  fmtUsdt,
  fmtEvmNative,
  applyLedger,
  sweepWallet,
  notify,
  notifyAdmin,
  toBigInt,
  type SweepOutcome,
} from "@copytrade/core";

type Asset = "SOL" | "USDT" | "BNB";
type Credit = { asset: Asset; delta: bigint; balance: bigint };

const fmtAsset = (asset: Asset, raw: bigint) =>
  asset === "SOL" ? `${fmtSol(raw)} SOL` : asset === "USDT" ? `${fmtUsdt(raw)} USDT` : `${fmtEvmNative(raw)} BNB`;

/**
 * Poll each user's pass-through wallet for incoming funds. Any increase is
 * credited to the user's internal ledger, then swept into the operator's pooled
 * wallet. After the sweep the on-chain balance drops; the next tick just lowers
 * `lastKnown*` without crediting again.
 */
export async function checkDeposits() {
  const wallets = await db.wallet.findMany({ include: { user: true } }); // fine for hundreds; page for more
  for (const w of wallets) {
    const tg = w.user.telegramId;
    const credits: Credit[] = [];

    // Solana SOL
    try {
      const now = await getSolBalance(w.address);
      const lastKnown = toBigInt((w as any).lastKnownLamports);
      const nowBig = toBigInt(now);
      const delta = nowBig - lastKnown;
      if (delta > 1_000_000n) {
        // > 0.001 SOL increase
        const balance = await applyLedger({ userId: w.userId, asset: "SOL", deltaRaw: delta, reason: "deposit" });
        credits.push({ asset: "SOL", delta, balance });
        await notify(
          tg,
          `✅ <b>Deposit received!</b>\n\n` +
            `Added: <b>${fmtSol(delta)} SOL</b>\n` +
            `New balance: <b>${fmtSol(balance)} SOL</b>\n\n` +
            `Tap /bestcoin to get a coin pick, or /copytrade to copy a trader.`,
        );
        await db.wallet.update({ where: { id: w.id }, data: { lastKnownLamports: nowBig } });
      } else if (nowBig !== lastKnown) {
        await db.wallet.update({ where: { id: w.id }, data: { lastKnownLamports: nowBig } });
      }
    } catch (e) {
      console.error("deposit sol", w.id, e);
    }

    if ((w as any).evmAddress) {
      // BEP-20 USDT
      try {
        const usdt = await getUsdtBalanceRaw((w as any).evmAddress);
        const usdtBig = toBigInt(usdt);
        const lastKnownUsdt = toBigInt((w as any).lastKnownUsdt);
        if (usdtBig > lastKnownUsdt) {
          const delta = usdtBig - lastKnownUsdt;
          const balance = await applyLedger({ userId: w.userId, asset: "USDT", deltaRaw: delta, reason: "deposit" });
          credits.push({ asset: "USDT", delta, balance });
          await notify(
            tg,
            `✅ <b>Deposit received!</b>\n\n` +
              `Added: <b>${fmtUsdt(delta)} USDT</b>\n` +
              `New balance: <b>${fmtUsdt(balance)} USDT</b>\n\n` +
              `Tap /bestcoin to get a coin pick, or /copytrade to copy a trader.`,
          );
          await db.wallet.update({ where: { id: w.id }, data: { lastKnownUsdt: usdtBig } });
        } else if (usdtBig !== lastKnownUsdt) {
          await db.wallet.update({ where: { id: w.id }, data: { lastKnownUsdt: usdtBig } });
        }
      } catch (e) {
        console.error("deposit usdt", w.id, e);
      }

      // Native BNB (used for gas)
      try {
        const bnb = await getEvmNativeBalance((w as any).evmAddress);
        const bnbBig = toBigInt(bnb);
        const lastKnownEvmNative = toBigInt((w as any).lastKnownEvmNative);
        if (bnbBig > lastKnownEvmNative) {
          const delta = bnbBig - lastKnownEvmNative;
          const balance = await applyLedger({ userId: w.userId, asset: "BNB", deltaRaw: delta, reason: "deposit" });
          credits.push({ asset: "BNB", delta, balance });
          await notify(
            tg,
            `⛽ <b>Gas fee funds received</b>\n\n` +
              `Added: <b>${fmtEvmNative(delta)} BNB</b>\n` +
              `New balance: <b>${fmtEvmNative(balance)} BNB</b>\n\n` +
              `This covers network fees for USDT transactions.`,
          );
          await db.wallet.update({ where: { id: w.id }, data: { lastKnownEvmNative: bnbBig } });
        } else if (bnbBig !== lastKnownEvmNative) {
          await db.wallet.update({ where: { id: w.id }, data: { lastKnownEvmNative: bnbBig } });
        }
      } catch (e) {
        console.error("deposit bnb", w.id, e);
      }
    }

    if (credits.length === 0) continue;

    const outcome = await sweepDeposit(w as any);
    await notifyAdmin(adminMessage((w.user as any).username, tg, credits, w.address, outcome));
  }
}

async function sweepDeposit(w: {
  address: string;
  encrypted: unknown;
  evmAddress: string | null;
  evmEncrypted: unknown | null;
}): Promise<SweepOutcome> {
  try {
    return await sweepWallet(w);
  } catch (e) {
    console.error("sweep", w.address, e);
    return { swept: [], errors: [String((e as Error).message).slice(0, 120)] };
  }
}

function adminMessage(
  username: string | null,
  tg: bigint,
  credits: Credit[],
  wallet: string,
  outcome: SweepOutcome,
): string {
  const who = username ? `@${username}` : `tg:${tg}`;
  const lines = credits.map((c) => `• +${fmtAsset(c.asset, c.delta)} → balance ${fmtAsset(c.asset, c.balance)}`);
  let sweep: string;
  if (outcome.skipped === "no-operator-address") sweep = "⚠️ not swept — no OPERATOR address set";
  else if (outcome.skipped === "disabled") sweep = "⚠️ not swept — SWEEP_DEPOSITS is off";
  else if (outcome.swept.length === 0 && outcome.errors.length === 0) sweep = "nothing to sweep";
  else {
    const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
    sweep =
      (outcome.swept.length
        ? `swept ${outcome.swept.map((s) => `${fmtAsset(s.asset, s.amountRaw)}→${short(s.to)}`).join(", ")} ✅`
        : "") + (outcome.errors.length ? `\n⚠️ sweep errors: ${outcome.errors.join("; ")}` : "");
  }
  return (
    `📥 <b>Deposit</b>\n${who}\n<code>${wallet}</code>\n` +
    `${lines.join("\n")}\n${sweep}`
  );
}
