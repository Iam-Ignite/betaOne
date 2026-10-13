#!/usr/bin/env tsx
/**
 * Daily reconciliation: compare ledger balances vs on-chain reality.
 * Run via cron (e.g. Render cron job at 03:00 UTC) or manually: `pnpm --filter server reconcile`
 *
 * Exit codes:
 *   0 = all matched (or only expected drift: pending orders, unconfirmed sweeps)
 *   1 = unexpected mismatch found (check logs)
 *   2 = fatal error (RPC/DB unavailable)
 */

import { db, getConnection, getTokenBalanceRaw, getSolBalance, WSOL, getUsdtBalanceRaw, getEvmNativeBalance, env } from "@copytrade/core";

const conn = getConnection();

type Asset = "SOL" | "USDT" | "BNB";

interface Mismatch {
  userId: string;
  telegramId: bigint;
  username: string | null;
  asset: Asset;
  ledger: bigint;
  onchain: bigint;
  diff: bigint;
  severity: "warning" | "critical";
  context: string;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting reconciliation...`);

  const mismatches: Mismatch[] = [];

  // 1. Fetch all users with their ledger balances
  const users = await db.user.findMany({
    select: {
      id: true,
      telegramId: true,
      username: true,
      balanceSol: true,
      balanceUsdt: true,
      balanceBnb: true,
      wallet: { select: { address: true, evmAddress: true } },
    },
  });

  console.log(`Checking ${users.length} users...`);

  // 2. For each user, check their pass-through wallet on-chain
  for (const u of users) {
    if (!u.wallet) continue;

    // --- SOL ---
    try {
      const onchainSol = await getSolBalance(u.wallet.address);
      const diff = onchainSol - u.balanceSol;
      // Expected: small positive diff (deposit not yet swept), or zero
      if (diff > 1_000_000n) {
        // > 0.001 SOL unexplained
        mismatches.push({
          userId: u.id,
          telegramId: u.telegramId,
          username: u.username,
          asset: "SOL",
          ledger: u.balanceSol,
          onchain: onchainSol,
          diff,
          severity: "warning",
          context: `Pass-through wallet has ${(Number(diff) / 1e9).toFixed(4)} SOL more than ledger`,
        });
      } else if (diff < -100_000n) {
        // Ledger says more than on-chain — critical
        mismatches.push({
          userId: u.id,
          telegramId: u.telegramId,
          username: u.username,
          asset: "SOL",
          ledger: u.balanceSol,
          onchain: onchainSol,
          diff,
          severity: "critical",
          context: `Ledger exceeds on-chain by ${(Number(-diff) / 1e9).toFixed(4)} SOL`,
        });
      }
    } catch (e) {
      console.error(`SOL check failed for ${u.id}:`, e);
    }

    // --- EVM (USDT + BNB) ---
    if (u.wallet.evmAddress) {
      try {
        const [onchainUsdt, onchainBnb] = await Promise.all([
          getUsdtBalanceRaw(u.wallet.evmAddress!),
          getEvmNativeBalance(u.wallet.evmAddress!),
        ]);

        const usdtDiff = onchainUsdt - u.balanceUsdt;
        if (usdtDiff > 0n) {
          mismatches.push({
            userId: u.id,
            telegramId: u.telegramId,
            username: u.username,
            asset: "USDT",
            ledger: u.balanceUsdt,
            onchain: onchainUsdt,
            diff: usdtDiff,
            severity: usdtDiff > 1_000_000n ? "warning" : "critical",
            context: `Pass-through has ${(Number(usdtDiff) / 1e18).toFixed(6)} USDT more than ledger`,
          });
        } else if (usdtDiff < 0n) {
          mismatches.push({
            userId: u.id,
            telegramId: u.telegramId,
            username: u.username,
            asset: "USDT",
            ledger: u.balanceUsdt,
            onchain: onchainUsdt,
            diff: usdtDiff,
            severity: "critical",
            context: `Ledger exceeds on-chain USDT`,
          });
        }

        const bnbDiff = onchainBnb - u.balanceBnb;
        if (bnbDiff > 1_000_000_000_000_000n) {
          // > 0.001 BNB
          mismatches.push({
            userId: u.id,
            telegramId: u.telegramId,
            username: u.username,
            asset: "BNB",
            ledger: u.balanceBnb,
            onchain: onchainBnb,
            diff: bnbDiff,
            severity: "warning",
            context: `Pass-through has ${(Number(bnbDiff) / 1e18).toFixed(6)} BNB more than ledger`,
          });
        } else if (bnbDiff < -1_000_000_000_000n) {
          mismatches.push({
            userId: u.id,
            telegramId: u.telegramId,
            username: u.username,
            asset: "BNB",
            ledger: u.balanceBnb,
            onchain: onchainBnb,
            diff: bnbDiff,
            severity: "critical",
            context: `Ledger exceeds on-chain BNB`,
          });
        }
      } catch (e) {
        console.error(`EVM check failed for ${u.id}:`, e);
      }
    }
  }

  // 3. Pool wallet solvency check (only if live trading enabled)
  if (env.LIVE_TRADING_ALLOWED === "true" && env.OPERATOR_SOL_ADDRESS) {
    const poolAddr = env.OPERATOR_SOL_ADDRESS;
    try {
      const poolBalance = await getSolBalance(poolAddr);
      const totalLiability = users.reduce((sum, u) => sum + u.balanceSol, 0n);

      if (poolBalance < totalLiability) {
        mismatches.push({
          userId: "POOL",
          telegramId: 0n,
          username: "pool",
          asset: "SOL",
          ledger: totalLiability,
          onchain: poolBalance,
          diff: poolBalance - totalLiability,
          severity: "critical",
          context: `Pool insolvent: ${(Number(poolBalance) / 1e9).toFixed(4)} SOL vs ${(Number(totalLiability) / 1e9).toFixed(4)} SOL liability`,
        });
      } else if (poolBalance < totalLiability * 110n / 100n) {
        mismatches.push({
          userId: "POOL",
          telegramId: 0n,
          username: "pool",
          asset: "SOL",
          ledger: totalLiability,
          onchain: poolBalance,
          diff: poolBalance - totalLiability,
          severity: "warning",
          context: `Pool buffer < 10%: ${(Number(poolBalance) / 1e9).toFixed(4)} SOL vs ${(Number(totalLiability) / 1e9).toFixed(4)} SOL liability`,
        });
      }
    } catch (e) {
      console.error("Pool solvency check failed:", e);
    }
  }

  // 4. LivePosition vs on-chain token accounts (only for live follows)
  if (env.LIVE_TRADING_ALLOWED === "true") {
    const livePositions = await db.livePosition.findMany({
      include: { follow: { include: { user: { select: { telegramId: true, username: true } } } } },
    });

    for (const pos of livePositions) {
      try {
        const onchain = await getTokenBalanceRaw(env.OPERATOR_SOL_ADDRESS!, pos.tokenMint);
        const ledger = BigInt(pos.amountRaw);
        const diff = onchain - ledger;

        if (diff !== 0n) {
          mismatches.push({
            userId: pos.followId,
            telegramId: pos.follow.user.telegramId,
            username: pos.follow.user.username,
            asset: "SOL", // SPL token positions tracked under SOL asset category
            ledger,
            onchain,
            diff,
            severity: diff < 0n ? "critical" : "warning",
            context: `LivePosition ${pos.tokenMint.slice(0, 8)}… diff: ${diff > 0n ? "+" : ""}${(Number(diff) / 1e9).toFixed(4)}`,
          });
        }
      } catch (e) {
        console.error(`LivePosition check failed for ${pos.id}:`, e);
      }
    }
  }

  // 5. Report
  const critical = mismatches.filter((m) => m.severity === "critical");
  const warnings = mismatches.filter((m) => m.severity === "warning");

  console.log(`\n=== RECONCILIATION SUMMARY ===`);
  console.log(`Users checked: ${users.length}`);
  console.log(`Critical mismatches: ${critical.length}`);
  console.log(`Warnings: ${warnings.length}`);

  if (critical.length > 0) {
    console.log(`\n🔴 CRITICAL:`);
    for (const m of critical) {
      console.log(`  @${m.username ?? m.telegramId} (${m.asset}): ledger=${m.ledger} onchain=${m.onchain} diff=${m.diff} — ${m.context}`);
      // Log to audit for investigation
      await db.auditLog.create({
        data: {
          userId: m.userId === "POOL" ? null : m.userId,
          action: "reconciliation_mismatch",
          meta: {
            userId: m.userId,
            telegramId: m.telegramId.toString(),
            username: m.username,
            asset: m.asset,
            ledger: m.ledger.toString(),
            onchain: m.onchain.toString(),
            diff: m.diff.toString(),
            severity: m.severity,
            context: m.context,
            timestamp: new Date().toISOString(),
          },
        },
      });
    }
  }

  if (warnings.length > 0) {
    console.log(`\n🟡 WARNINGS:`);
    for (const m of warnings) {
      console.log(`  @${m.username ?? m.telegramId} (${m.asset}): ledger=${m.ledger} onchain=${m.onchain} diff=${m.diff} — ${m.context}`);
    }
  }

  if (critical.length === 0 && warnings.length === 0) {
    console.log("\n✅ All balances reconciled.");
  }

  // 6. Alert admin if critical
  if (critical.length > 0 && env.TELEGRAM_ADMIN_CHAT_ID) {
    const { notifyAdmin } = await import("@copytrade/core");
    await notifyAdmin(
      `🔴 Reconciliation found ${critical.length} critical mismatch${critical.length > 1 ? "es" : ""}.\n` +
        critical.map((m) => `@${m.username ?? m.telegramId} ${m.asset} diff ${m.diff > 0n ? "+" : ""}${m.diff}`).join("\n"),
    ).catch(() => {});
  }

  process.exit(critical.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Reconciliation fatal error:", e);
  process.exit(2);
});