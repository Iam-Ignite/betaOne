import { createWebhook } from "@copytrade/core";

async function main() {
  const addresses = process.argv.slice(2).filter(Boolean);
  if (addresses.length === 0) {
    console.error("Usage: create-helius-webhook <traderAddress> [moreAddresses...]");
    process.exit(1);
  }
  const res = (await createWebhook(addresses)) as { webhookID?: string };
  console.log("Helius webhook created:", res);
  if (res?.webhookID) {
    console.log(`Set HELIUS_WEBHOOK_ID=${res.webhookID} in your .env`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
