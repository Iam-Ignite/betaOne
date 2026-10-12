import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { decryptSecret, type EncryptedSecret } from "./crypto";

let _conn: Connection | null = null;

export function getConnection(): Connection {
  if (!_conn) {
    const url = process.env.HELIUS_RPC_URL;
    if (!url) throw new Error("HELIUS_RPC_URL is not configured");
    _conn = new Connection(url, "confirmed");
  }
  return _conn;
}

/**
 * Lazily-built connection. `conn.getBalance(...)` etc. work as normal, but the
 * underlying Connection is only created on first use so importing core does not
 * require a configured RPC URL.
 */
export const conn = new Proxy({} as Connection, {
  get(_target, prop) {
    const c = getConnection() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? value.bind(c) : value;
  },
});

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const QUOTE_MINTS = new Set([WSOL, USDC, USDT]);

export const RESERVE_LAMPORTS = 10_000_000n; // keep 0.01 SOL for fees and new token account rent

export const fmtSol = (l: bigint | number) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);

export function newWallet() {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), secretKey: kp.secretKey };
}

export function loadKeypair(enc: EncryptedSecret): Keypair {
  return Keypair.fromSecretKey(decryptSecret(enc));
}

export async function getSolBalance(address: string): Promise<bigint> {
  return BigInt(await conn.getBalance(new PublicKey(address)));
}

export async function getTokenBalances(address: string) {
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), {
    programId: TOKEN_PROGRAM_ID,
  });
  return res.value
    .map((a) => {
      const i = a.account.data.parsed.info;
      return {
        mint: i.mint as string,
        raw: BigInt(i.tokenAmount.amount),
        ui: i.tokenAmount.uiAmountString as string,
      };
    })
    .filter((t) => t.raw > 0n);
}

export async function getTokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

/** Native SOL kept back when sweeping a pass-through wallet (covers the network fee). */
export const SWEEP_SOL_RESERVE_LAMPORTS = 5000n;

/** Send native SOL from an encrypted custodial key. Returns the signature. */
export async function sendSol(
  enc: EncryptedSecret,
  to: string,
  lamports: bigint,
): Promise<string> {
  const kp = loadKeypair(enc);
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(to),
        lamports,
      }),
    );
    tx.sign(kp);
    const sig = bs58.encode(tx.signature!);
    await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  } finally {
    kp.secretKey.fill(0);
  }
}
