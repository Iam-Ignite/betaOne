import { env } from "./env";
import type { EncryptedSecret } from "./crypto";
import {
  getSolBalance,
  sendSol,
  SWEEP_SOL_RESERVE_LAMPORTS,
} from "./solana";
import {
  getUsdtBalanceRaw,
  getEvmNativeBalance,
  sendUsdt,
  sendEvmNative,
  EVM_GAS_RESERVE_WEI,
} from "./evm";

export interface SweepableWallet {
  address: string;
  encrypted: unknown;
  evmAddress: string | null;
  evmEncrypted: unknown | null;
}

export interface SweepResult {
  asset: "SOL" | "USDT" | "BNB";
  amountRaw: bigint;
  txSignature: string;
  to: string;
}

export interface SweepOutcome {
  swept: SweepResult[];
  errors: string[];
  skipped?: "disabled" | "no-operator-address";
}

/** The configured split percentage to operator 2, clamped to 0–100. */
function sharePct(): bigint {
  const p = Math.round(Number(env.OPERATOR2_SHARE ?? 0));
  if (!Number.isFinite(p) || p <= 0) return 0n;
  return BigInt(Math.min(100, p));
}

/** Split `total` into [toOperator1, toOperator2]; single-element when no split. */
function split(total: bigint, pct: bigint): bigint[] {
  if (pct <= 0n) return [total];
  const to2 = (total * pct) / 100n;
  return [total - to2, to2];
}

/**
 * Move everything a user's pass-through wallet holds into the operator's pooled
 * wallets. Uses the user's own key (the bot custodies it) — the operator's
 * private key is never needed. When a second operator is configured, the given
 * share goes there and the remainder to operator 1. Failures are per-asset and
 * non-fatal so one stuck asset never blocks the rest.
 */
export async function sweepWallet(w: SweepableWallet): Promise<SweepOutcome> {
  if (env.SWEEP_DEPOSITS !== "true") return { swept: [], errors: [], skipped: "disabled" };

  const op1Sol = env.OPERATOR_SOL_ADDRESS;
  const op2Sol = env.OPERATOR2_SOL_ADDRESS;
  const op1Evm = env.OPERATOR_EVM_ADDRESS;
  const op2Evm = env.OPERATOR2_EVM_ADDRESS;
  if (!op1Sol && !op1Evm) return { swept: [], errors: [], skipped: "no-operator-address" };

  const pct = sharePct();
  const splitSol = !!op1Sol && !!op2Sol && pct > 0n;
  const splitEvm = !!op1Evm && !!op2Evm && pct > 0n;

  const swept: SweepResult[] = [];
  const errors: string[] = [];

  /* ------------------------------- Solana SOL ------------------------------- */
  if (op1Sol) {
    try {
      const bal = await getSolBalance(w.address);
      // Two transfers cost two base fees.
      const reserve = SWEEP_SOL_RESERVE_LAMPORTS * (splitSol ? 2n : 1n);
      const total = bal - reserve;
      if (total > 0n) {
        const parts = split(total, splitSol ? pct : 0n);
        if (parts[0] > 0n) {
          swept.push({ asset: "SOL", amountRaw: parts[0], txSignature: await sendSol(w.encrypted as EncryptedSecret, op1Sol, parts[0]), to: op1Sol });
        }
        if (parts[1] && parts[1] > 0n && op2Sol) {
          swept.push({ asset: "SOL", amountRaw: parts[1], txSignature: await sendSol(w.encrypted as EncryptedSecret, op2Sol, parts[1]), to: op2Sol });
        }
      }
    } catch (e) {
      errors.push(`SOL: ${String((e as Error).message).slice(0, 120)}`);
      console.error("sweep sol", w.address, e);
    }
  }

  /* ---------------------------- BEP-20 USDT / BNB --------------------------- */
  if (op1Evm && w.evmAddress && w.evmEncrypted) {
    const enc = w.evmEncrypted as EncryptedSecret;

    // USDT first: it spends the wallet's BNB on gas.
    try {
      const usdt = await getUsdtBalanceRaw(w.evmAddress);
      if (usdt > 0n) {
        const parts = split(usdt, splitEvm ? pct : 0n);
        if (parts[0] > 0n) {
          swept.push({ asset: "USDT", amountRaw: parts[0], txSignature: await sendUsdt(enc, op1Evm, parts[0]), to: op1Evm });
        }
        if (parts[1] && parts[1] > 0n && op2Evm) {
          swept.push({ asset: "USDT", amountRaw: parts[1], txSignature: await sendUsdt(enc, op2Evm, parts[1]), to: op2Evm });
        }
      }
    } catch (e) {
      errors.push(`USDT: ${String((e as Error).message).slice(0, 120)}`);
      console.error("sweep usdt", w.evmAddress, e);
    }

    try {
      const bnb = await getEvmNativeBalance(w.evmAddress);
      const reserve = EVM_GAS_RESERVE_WEI * (splitEvm ? 2n : 1n);
      const total = bnb - reserve;
      if (total > 0n) {
        const parts = split(total, splitEvm ? pct : 0n);
        if (parts[0] > 0n) {
          swept.push({ asset: "BNB", amountRaw: parts[0], txSignature: await sendEvmNative(enc, op1Evm, parts[0]), to: op1Evm });
        }
        if (parts[1] && parts[1] > 0n && op2Evm) {
          swept.push({ asset: "BNB", amountRaw: parts[1], txSignature: await sendEvmNative(enc, op2Evm, parts[1]), to: op2Evm });
        }
      }
    } catch (e) {
      errors.push(`BNB: ${String((e as Error).message).slice(0, 120)}`);
      console.error("sweep bnb", w.evmAddress, e);
    }
  }

  return { swept, errors };
}
