import { db, setWebhookAddresses } from "@copytrade/core";

let last = "";

export async function syncHeliusAddresses() {
  const traders = await db.trader.findMany({
    where: { active: true, follows: { some: { active: true } } },
    select: { address: true },
  });
  const addrs = traders.map((t) => t.address).sort();
  const key = addrs.join(",");
  if (key === last || !process.env.HELIUS_WEBHOOK_ID) return;
  await setWebhookAddresses(process.env.HELIUS_WEBHOOK_ID, addrs);
  last = key;
  console.log(`helius webhook synced with ${addrs.length} addresses`);
}
