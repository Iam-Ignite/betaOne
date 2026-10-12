"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type AdminUser = {
  telegramId: string;
  username: string | null;
  status: "ACTIVE" | "FROZEN";
  balances: { SOL: string; USDT: string; BNB: string };
  labels: { SOL: string; USDT: string; BNB: string };
  follows: { total: number; active: number; paper: number; live: number };
  wallet: { address: string; evmAddress: string | null } | null;
  pendingWithdrawals: number;
  createdAt: string;
};

export type PendingWithdrawal = {
  id: string;
  telegramId: string;
  asset: string;
  amountLabel: string;
  toAddress: string;
  createdAt: string;
};

const ASSETS = ["SOL", "USDT", "BNB"] as const;
type Asset = (typeof ASSETS)[number];

const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/* ---------------------------------------------------------------- primitives */

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 ring-1 ring-inset ring-zinc-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            value === o.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function BalanceChip({ asset, label }: { asset: Asset; label: string }) {
  const tone: Record<Asset, string> = {
    SOL: "bg-violet-50 text-violet-700 ring-violet-200",
    USDT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    BNB: "bg-amber-50 text-amber-700 ring-amber-200",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-mono ring-1 ring-inset ${tone[asset]}`}>
      {label} <span className="opacity-60">{asset}</span>
    </span>
  );
}

/* --------------------------------------------------------------- users table */

export function UsersPanel({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.telegramId.includes(q) || (u.username ?? "").toLowerCase().includes(q));
  }, [users, query]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Users</h2>
          <p className="text-xs text-zinc-500">
            {filtered.length} of {users.length} · click a user to manage their balance
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search @username or telegram id"
          className="w-64 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm outline-none focus:border-zinc-400 focus:bg-white"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">No users match.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {filtered.map((u) => {
            const isOpen = open === u.telegramId;
            return (
              <li key={u.telegramId} className={isOpen ? "bg-zinc-50/60" : ""}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : u.telegramId)}
                  className="flex w-full items-center gap-4 px-5 py-3 text-left transition hover:bg-zinc-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-xs font-semibold text-white">
                    {(u.username ?? u.telegramId).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {u.username ? `@${u.username}` : "—"}
                      </span>
                      {u.status === "FROZEN" && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-200">
                          FROZEN
                        </span>
                      )}
                      {u.pendingWithdrawals > 0 && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                          {u.pendingWithdrawals} withdrawal{u.pendingWithdrawals > 1 ? "s" : ""}
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-[11px] text-zinc-400">
                      {u.telegramId} · joined {fmtDate(u.createdAt)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
                    <BalanceChip asset="SOL" label={u.labels.SOL} />
                    <BalanceChip asset="USDT" label={u.labels.USDT} />
                    <BalanceChip asset="BNB" label={u.labels.BNB} />
                  </span>
                  <span className="hidden w-28 shrink-0 text-right text-xs text-zinc-500 md:block">
                    {u.follows.active} follow{u.follows.active === 1 ? "" : "s"}
                    <span className="block text-[11px] text-zinc-400">
                      {u.follows.live} live · {u.follows.paper} paper
                    </span>
                  </span>
                  <span className={`shrink-0 text-zinc-400 transition ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>

                {isOpen && <UserDetail user={u} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UserDetail({ user }: { user: AdminUser }) {
  return (
    <div className="space-y-4 border-t border-zinc-100 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Deposit addresses</h3>
          {user.wallet ? (
            <div className="space-y-1.5 text-xs">
              <AddressRow label="Solana" value={user.wallet.address} />
              {user.wallet.evmAddress && <AddressRow label="EVM" value={user.wallet.evmAddress} />}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No wallet yet (created on first /start).</p>
          )}
        </div>

        <div className="space-y-2 lg:hidden">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Balances</h3>
          <div className="flex flex-wrap gap-1.5">
            <BalanceChip asset="SOL" label={user.labels.SOL} />
            <BalanceChip asset="USDT" label={user.labels.USDT} />
            <BalanceChip asset="BNB" label={user.labels.BNB} />
          </div>
        </div>
      </div>

      <AdjustBalanceForm user={user} />
    </div>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
      <span className="text-[11px] font-semibold text-zinc-400">{label}</span>
      <code className="truncate font-mono text-[11px] text-zinc-600">{shortId(value)}</code>
      <CopyButton value={value} />
    </div>
  );
}

function AdjustBalanceForm({ user }: { user: AdminUser }) {
  const router = useRouter();
  const [asset, setAsset] = useState<Asset>("SOL");
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [action, setAction] = useState<"set" | "credit" | "debit">("set");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setMsg(null);
    const body =
      mode === "percent"
        ? { telegramId: user.telegramId, asset, mode, action: "credit", amount: value.trim(), reason }
        : { telegramId: user.telegramId, asset, mode, action, amount: value.trim(), reason };

    const res = await fetch("/api/admin/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? "Request failed" });
      return;
    }
    setMsg({ ok: true, text: `Updated — new balance ${data.balanceAfterLabel ?? data.balanceAfter}` });
    setValue("");
    start(() => router.refresh());
  }

  const presets = ["10", "25", "50", "-10", "-25", "-50"];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Adjust trading balance</h3>
        <span className="font-mono text-[11px] text-zinc-400">
          now {user.labels[asset]} {asset}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={asset}
          onChange={(v) => setAsset(v)}
          options={ASSETS.map((a) => ({ value: a, label: a }))}
        />
        <Segmented
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "amount", label: "Amount" },
            { value: "percent", label: "Percent" },
          ]}
        />
        {mode === "amount" && (
          <Segmented
            value={action}
            onChange={(v) => setAction(v)}
            options={[
              { value: "set", label: "Set" },
              { value: "credit", label: "Add" },
              { value: "debit", label: "Subtract" },
            ]}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder={mode === "percent" ? "e.g. 25 or -25" : `amount in ${asset}`}
            className="w-44 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 pr-8 text-sm outline-none focus:border-zinc-400 focus:bg-white"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
            {mode === "percent" ? "%" : asset}
          </span>
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
          className="w-52 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm outline-none focus:border-zinc-400 focus:bg-white"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
        >
          Apply
        </button>
      </div>

      {mode === "percent" && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setValue(p)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ${
                p.startsWith("-")
                  ? "bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
              }`}
            >
              {p}%
            </button>
          ))}
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>
          {msg.ok ? "✓ " : "✕ "}
          {msg.text}
        </p>
      )}
    </form>
  );
}

/* --------------------------------------------------------------- withdrawals */

export function WithdrawalsTable({ rows }: { rows: PendingWithdrawal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function act(id: string, action: "paid" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, txSignature: tx[id] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      start(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0)
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-8 text-center text-sm text-zinc-500 shadow-sm">
        No pending withdrawals.
      </div>
    );

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p>
      )}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-zinc-900">{r.amountLabel}</p>
              <p className="font-mono text-[11px] text-zinc-400">user {r.telegramId} · {fmtDate(r.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                PENDING
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
            <span className="text-[11px] font-semibold text-zinc-400">TO</span>
            <code className="truncate font-mono text-[11px] text-zinc-600">{r.toAddress}</code>
            <CopyButton value={r.toAddress} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs outline-none focus:border-zinc-400 focus:bg-white"
              placeholder="payout tx hash (optional)"
              value={tx[r.id] ?? ""}
              onChange={(e) => setTx((p) => ({ ...p, [r.id]: e.target.value }))}
            />
            <button
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              disabled={busy === r.id}
              onClick={() => act(r.id, "paid")}
            >
              Approve &amp; mark paid
            </button>
            <button
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-rose-600 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
              disabled={busy === r.id}
              onClick={() => act(r.id, "reject")}
            >
              Reject &amp; refund
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- pool */

export function PoolWalletForm({ hasWallet }: { hasWallet: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(action: "generate" | "import") {
    if (action === "import" && !confirm("Import this key? Copy-trades will sign from it.")) return;
    if (action === "generate" && hasWallet && !confirm("Replace the current pool wallet key?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/pool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, secret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      setMsg(`Pool wallet: ${data.address}`);
      setSecret("");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={() => run("generate")}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
        >
          Generate
        </button>
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs outline-none focus:border-zinc-400 focus:bg-white"
          placeholder="or paste base58 secret key to import"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button
          disabled={busy || !secret}
          onClick={() => run("import")}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-50 disabled:opacity-50"
        >
          Import
        </button>
      </div>
      {msg && <p className="text-xs text-zinc-600">{msg}</p>}
    </div>
  );
}
