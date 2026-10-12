"use client";

import { useCallback, useState } from "react";
import Script from "next/script";

type Follow = {
  id: string;
  trader: string;
  address: string;
  active: boolean;
  paper: boolean;
  buyLamports: string;
  maxLamports: string;
  slippageBps: number;
};
type Data = { wallet: string | null; follows: Follow[] };

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

export default function Mini() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready?.();
    webApp?.expand?.();
    const initData = webApp?.initData ?? "";
    const api = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
    if (!api) {
      setError("NEXT_PUBLIC_API_URL is not set");
      return;
    }
    const res = await fetch(`${api}/mini/follows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load");
      return;
    }
    setData((await res.json()) as Data);
  }, []);

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6 font-sans">
      <Script src="https://telegram.org/js/telegram-web-app.js" onLoad={load} />
      <h1 className="text-xl font-bold">Your copy-trades</h1>
      {error && <p className="text-red-600">{error}</p>}
      {data?.wallet && (
        <p className="break-all text-sm text-zinc-500">
          Wallet: <code>{data.wallet}</code>
        </p>
      )}
      <ul className="space-y-3">
        {data?.follows.map((f) => (
          <li key={f.id} className="rounded-lg border p-3">
            <div className="font-semibold">
              {f.active ? "🟢" : "⚪️"} {f.trader} {f.paper ? "(paper)" : "(LIVE)"}
            </div>
            <div className="break-all text-xs text-zinc-500">{f.address}</div>
            <div className="text-sm">
              Buy: {(Number(f.buyLamports) / 1e9).toFixed(3)} SOL · Slippage: {f.slippageBps / 100}%
            </div>
          </li>
        ))}
      </ul>
      {data && data.follows.length === 0 && (
        <p className="text-zinc-500">No follows yet. Use /copytrade in the chat.</p>
      )}
    </main>
  );
}
