import { QUOTE_MINTS, WSOL } from "./solana";

export type ParsedSwap = {
  signature: string;
  trader: string;
  side: "BUY" | "SELL";
  tokenMint: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  blockTime: Date;
};

/**
 * Parse a Helius *enhanced* transaction of type SWAP. Field names follow Helius'
 * enhanced format (verify against a real payload).
 */
export function parseSwap(tx: any): ParsedSwap | null {
  if (tx?.type !== "SWAP" || !tx.events?.swap) return null;
  const s = tx.events.swap;

  const input = s.tokenInputs?.[0]
    ? { mint: s.tokenInputs[0].mint as string, raw: String(s.tokenInputs[0].rawTokenAmount.tokenAmount) }
    : s.nativeInput
      ? { mint: WSOL, raw: String(s.nativeInput.amount) }
      : null;
  const output = s.tokenOutputs?.[0]
    ? { mint: s.tokenOutputs[0].mint as string, raw: String(s.tokenOutputs[0].rawTokenAmount.tokenAmount) }
    : s.nativeOutput
      ? { mint: WSOL, raw: String(s.nativeOutput.amount) }
      : null;
  if (!input || !output) return null;

  const inIsQuote = QUOTE_MINTS.has(input.mint);
  const outIsQuote = QUOTE_MINTS.has(output.mint);
  if (inIsQuote === outIsQuote) return null; // token↔token or quote↔quote: ignore in v1

  return {
    signature: tx.signature,
    trader: tx.feePayer,
    side: inIsQuote ? "BUY" : "SELL",
    tokenMint: inIsQuote ? output.mint : input.mint,
    inputMint: input.mint,
    outputMint: output.mint,
    inAmount: input.raw,
    outAmount: output.raw,
    blockTime: new Date((tx.timestamp ?? Date.now() / 1000) * 1000),
  };
}

const API = "https://api.helius.xyz/v0/webhooks";

function key(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY is not configured");
  return k;
}

function webhookBody(addresses: string[]) {
  return {
    webhookURL: `${process.env.PUBLIC_BASE_URL}/helius`,
    transactionTypes: ["SWAP"],
    accountAddresses: addresses,
    webhookType: "enhanced",
    authHeader: process.env.HELIUS_WEBHOOK_SECRET,
  };
}

export async function createWebhook(addresses: string[]) {
  const r = await fetch(`${API}?api-key=${key()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhookBody(addresses)),
  });
  if (!r.ok) throw new Error(`Helius create failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function setWebhookAddresses(webhookId: string, addresses: string[]) {
  // The update call replaces the webhook definition, so resend the full config.
  // Changes can take ~2 minutes to take effect.
  const r = await fetch(`${API}/${webhookId}?api-key=${key()}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhookBody(addresses)),
  });
  if (!r.ok) throw new Error(`Helius update failed: ${r.status}`);
}
