import {
  db,
  newWallet,
  newEvmWallet,
  encryptSecret,
  type Wallet,
} from "@copytrade/core";

/** Add the EVM key pair to a wallet created before USDT support existed. */
async function backfillEvm(w: Wallet): Promise<Wallet> {
  if (w.evmAddress && w.evmEncrypted) return w;
  const evm = newEvmWallet();
  try {
    return await db.wallet.update({
      where: { id: w.id },
      data: {
        evmAddress: evm.address,
        evmEncrypted: encryptSecret(evm.secretKey) as unknown as object,
      },
    });
  } finally {
    evm.secretKey.fill(0);
  }
}

/**
 * Create the user's custodial wallets on first real use (Deposit / Copy address).
 * Each user gets one permanent Solana address and one EVM (USDT) address.
 */
export async function ensureWallet(userId: string): Promise<Wallet> {
  const existing = await db.wallet.findUnique({ where: { userId } });
  if (existing) return backfillEvm(existing);

  const sol = newWallet();
  const evm = newEvmWallet();
  try {
    return await db.wallet.create({
      data: {
        userId,
        address: sol.address,
        encrypted: encryptSecret(sol.secretKey) as unknown as object,
        evmAddress: evm.address,
        evmEncrypted: encryptSecret(evm.secretKey) as unknown as object,
      },
    });
  } catch (e) {
    // Two rapid taps raced to create the wallet; return whichever won.
    const created = await db.wallet.findUnique({ where: { userId } });
    if (created) return created;
    throw e;
  } finally {
    sol.secretKey.fill(0);
    evm.secretKey.fill(0);
  }
}
