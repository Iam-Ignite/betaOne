import { PublicKey } from "@solana/web3.js";
import { conn } from "./solana";

export class SkipError extends Error {}

/** Basic checks. Many legitimate tokens have authorities, so make this per-follow configurable. */
export async function assertTokenSafe(mint: string) {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  const parsed = (info.value?.data as any)?.parsed?.info;
  if (!parsed) throw new SkipError("token mint could not be read");
  if (parsed.mintAuthority) throw new SkipError("mint authority is not renounced");
  if (parsed.freezeAuthority) throw new SkipError("freeze authority is set");
}
