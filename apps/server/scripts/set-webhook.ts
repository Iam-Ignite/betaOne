import { bot, registerWebhook } from "../src/bot/index";

async function main() {
  await bot.init();
  const url = await registerWebhook();
  if (!url) {
    throw new Error(
      "PUBLIC_BASE_URL must be set to a public URL — Telegram can't reach localhost",
    );
  }
  console.log(`webhook + commands set: ${url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
