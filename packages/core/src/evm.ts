import {
  defineChain,
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  isAddress,
  getAddress,
  formatUnits,
  parseUnits,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { decryptSecret, type EncryptedSecret } from "./crypto";

const asHex = (secret: Uint8Array) => `0x${Buffer.from(secret).toString("hex")}` as `0x${string}`;

/** Generate a fresh EVM (secp256k1) wallet for USDT deposits. */
export function newEvmWallet() {
  const secretKey = new Uint8Array(Buffer.from(generatePrivateKey().slice(2), "hex"));
  const account = privateKeyToAccount(asHex(secretKey));
  return { address: account.address, secretKey };
}

/** Decrypt a stored EVM key and return a signing account. */
export function loadEvmAccount(enc: EncryptedSecret): PrivateKeyAccount {
  const secret = decryptSecret(enc);
  try {
    return privateKeyToAccount(asHex(secret));
  } finally {
    secret.fill(0);
  }
}

export const isEvmAddress = (s: string): boolean => isAddress(s);

export { getAddress as checksumEvmAddress };

/* ------------------------------ chain config ------------------------------ */

/** Lazily built so importing core never requires EVM env vars. */
export function evmChain(): Chain {
  const id = Number(process.env.EVM_CHAIN_ID ?? 56);
  const symbol = process.env.EVM_GAS_SYMBOL ?? "BNB";
  const rpc = process.env.EVM_RPC_URL ?? "https://bsc-dataseed.binance.org";
  const explorer = process.env.EVM_EXPLORER_URL ?? "https://bscscan.com";
  return defineChain({
    id,
    name: process.env.EVM_USDT_NETWORK ?? "BNB Smart Chain",
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
  });
}

export const evmUsdtAddress = () =>
  getAddress(process.env.EVM_USDT_ADDRESS ?? "0x55d398326f99059fF775485246999027B3197955");

export const evmUsdtDecimals = () => Number(process.env.EVM_USDT_DECIMALS ?? 18);

export const evmExplorerTx = (hash: string) =>
  `${process.env.EVM_EXPLORER_URL ?? "https://bscscan.com"}/tx/${hash}`;

/** Gas left untouched when sweeping the full native balance (BEP-20 transfers cost ~0.0001 BNB). */
export const EVM_GAS_RESERVE_WEI = 500_000_000_000_000n; // 0.0005 BNB

export const fmtUsdt = (raw: bigint) => formatUnits(raw, evmUsdtDecimals());
export const fmtEvmNative = (raw: bigint) => formatUnits(raw, 18);
export const parseUsdt = (text: string) => parseUnits(text, evmUsdtDecimals());

function publicClient(): PublicClient {
  const chain = evmChain();
  return createPublicClient({ chain, transport: http() });
}

function signingClient(account: PrivateKeyAccount): WalletClient {
  const chain = evmChain();
  return createWalletClient({ account, chain, transport: http() });
}

/* -------------------------------- balances -------------------------------- */

export async function getEvmNativeBalance(address: string): Promise<bigint> {
  return publicClient().getBalance({ address: getAddress(address) });
}

export async function getUsdtBalanceRaw(address: string): Promise<bigint> {
  return publicClient().readContract({
    address: evmUsdtAddress(),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  }) as Promise<bigint>;
}

/* -------------------------------- transfers ------------------------------- */

/**
 * Broadcast a BEP-20 USDT transfer from the user's wallet.
 * Returns the tx hash as soon as it is broadcast so the caller can persist the
 * intent BEFORE/at send time (never blind-retry). Use waitForEvmReceipt to confirm.
 */
export async function sendUsdt(
  enc: EncryptedSecret,
  to: string,
  amountRaw: bigint,
): Promise<`0x${string}`> {
  const account = loadEvmAccount(enc);
  const chain = evmChain();
  return signingClient(account).writeContract({
    account,
    chain,
    address: evmUsdtAddress(),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), amountRaw],
  });
}

/** Broadcast a native (BNB) transfer from the user's wallet. */
export async function sendEvmNative(
  enc: EncryptedSecret,
  to: string,
  wei: bigint,
): Promise<`0x${string}`> {
  const account = loadEvmAccount(enc);
  const chain = evmChain();
  return signingClient(account).sendTransaction({
    account,
    chain,
    to: getAddress(to),
    value: wei,
  });
}

export async function waitForEvmReceipt(hash: `0x${string}`) {
  return publicClient().waitForTransactionReceipt({ hash });
}

export { parseUnits, formatUnits };
