export type FollowRules = {
  buyLamports: bigint;
  maxLamports: bigint;
  copyBuys: boolean;
  copySells: boolean;
};

export type Plan =
  | { kind: "skip"; reason: string }
  | { kind: "buy"; lamports: bigint }
  | { kind: "sell"; fraction: number }; // v1: always 1.0 (sell our whole position)

export function planCopy(
  side: "BUY" | "SELL",
  rules: FollowRules,
  ctx: { solBalance: bigint; reserve: bigint; haveTokens: boolean },
): Plan {
  if (side === "BUY") {
    if (!rules.copyBuys) return { kind: "skip", reason: "buys disabled" };
    const spendable = ctx.solBalance - ctx.reserve;
    let amount = rules.buyLamports < rules.maxLamports ? rules.buyLamports : rules.maxLamports;
    if (amount > spendable) amount = spendable;
    if (amount <= 0n) return { kind: "skip", reason: "not enough SOL" };
    return { kind: "buy", lamports: amount };
  }
  if (!rules.copySells) return { kind: "skip", reason: "sells disabled" };
  if (!ctx.haveTokens) return { kind: "skip", reason: "no position to sell" };
  return { kind: "sell", fraction: 1 };
}
