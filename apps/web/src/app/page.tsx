export default function Home() {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "YourBot";
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col gap-6 px-6 py-20 font-sans">
      <h1 className="text-3xl font-bold">Solana copy-trading bot</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Get your own Solana wallet in Telegram, deposit funds, pick wallets to follow, and the bot
        mirrors their swaps from your wallet.
      </p>

      <a
        href={`https://t.me/${bot}`}
        className="inline-flex h-12 w-fit items-center rounded-full bg-foreground px-6 font-medium text-background"
      >
        Open in Telegram
      </a>

      <section className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="text-base font-semibold text-black dark:text-zinc-100">Commands</h2>
        <ul className="list-disc pl-5">
          <li>/start — create your wallet and open the menu</li>
          <li>/wallet — show your Solana address</li>
          <li>/balance — SOL and token balances</li>
          <li>/deposit — get your deposit address</li>
          <li>/withdraw — send SOL to an external address</li>
          <li>/copytrade — follow a wallet and manage rules</li>
        </ul>
      </section>

      <p className="rounded-lg border border-red-300/40 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
        ⚠️ Not financial advice. Copy trading is risky and you can lose everything you deposit.
        Past performance is not indicative of future results.
      </p>
    </main>
  );
}
