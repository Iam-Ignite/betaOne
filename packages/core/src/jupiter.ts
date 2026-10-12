import { VersionedTransaction, type Keypair } from "@solana/web3.js";

const BASE = "https://api.jup.ag/swap/v2";

function headers(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("JUPITER_API_KEY is not configured");
  return { "x-api-key": key };
}

export type JupOrder = {
  requestId: string;
  transaction: string; // base64, unsigned; "" or null if no taker or it could not be built
  inAmount?: string;
  outAmount?: string;
  [k: string]: unknown;
};

/** Without `taker` you get a quote but no transaction (use for paper trading). */
export async function getOrder(p: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  taker?: string;
  slippageBps?: number;
}): Promise<JupOrder> {
  const qs = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount.toString(),
  });
  if (p.taker) qs.set("taker", p.taker);
  if (p.slippageBps) qs.set("slippageBps", String(p.slippageBps)); // (verify param name)
  const r = await fetch(`${BASE}/order?${qs}`, { headers: headers() });
  if (!r.ok) throw new Error(`Jupiter /order ${r.status}: ${await r.text()}`);
  return r.json() as Promise<JupOrder>;
}

export async function executeOrder(signedTxBase64: string, requestId: string) {
  const r = await fetch(`${BASE}/execute`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: signedTxBase64, requestId }),
  });
  if (!r.ok) throw new Error(`Jupiter /execute ${r.status}: ${await r.text()}`);
  return r.json() as Promise<Record<string, unknown>>; // inspect status/signature fields (verify)
}

/** Worker only. Signs the returned transaction; market makers add their signatures on /execute. */
export function signOrderTx(order: JupOrder, kp: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([kp]);
  return Buffer.from(tx.serialize()).toString("base64");
}
