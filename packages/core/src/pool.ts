import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { db } from "./db";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "./crypto";
import { getSolBalance, newWallet } from "./solana";

const KEY = "pool_sol_encrypted";

export async function hasPoolWallet(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  return !!row;
}

/** The pool trading keypair, or null when the operator hasn't set one up. */
export async function getPoolKeypair(): Promise<Keypair | null> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  return Keypair.fromSecretKey(decryptSecret(JSON.parse(row.value) as EncryptedSecret));
}

export async function getPoolAddress(): Promise<string | null> {
  const kp = await getPoolKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

/** Store the pool signing key, encrypted at rest with WALLET_KEK. */
export async function setPoolKeypair(secretKey: Uint8Array): Promise<string> {
  const address = Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  const enc = encryptSecret(secretKey);
  const value = JSON.stringify(enc);
  await db.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return address;
}

/** Generate and store a brand-new pool wallet. */
export async function createPoolWallet(): Promise<string> {
  const w = newWallet();
  try {
    return await setPoolKeypair(w.secretKey);
  } finally {
    w.secretKey.fill(0);
  }
}

/** Import an existing Solana key from base58 (e.g. a Phantom export). */
export async function importPoolKeypair(base58Secret: string): Promise<string> {
  const secret = new Uint8Array(bs58.decode(base58Secret.trim()));
  try {
    return await setPoolKeypair(secret);
  } finally {
    secret.fill(0);
  }
}

/** Live SOL balance held by the pool wallet (0n when unconfigured). */
export async function getPoolBalance(): Promise<bigint> {
  const address = await getPoolAddress();
  if (!address) return 0n;
  return getSolBalance(address);
}
