import { connection } from "next/server";
import { backendFetch, backendConfigured } from "@/lib/backend";
import {
  UsersPanel,
  WithdrawalsTable,
  PoolWalletForm,
  CopyButton,
  type AdminUser,
  type PendingWithdrawal,
} from "./admin-actions";

// Admin is a live dashboard: render at request time (never cache).
export const instant = false;

type Dashboard = {
  stats: { users: number; follows: number; pending: number; withdrawals: number; failed24h: number };
  pool: { address: string | null; balanceSol: string; liabilitySol: string };
  pendingWithdrawals: PendingWithdrawal[];
  recentFailed: { id: string; side: string; tokenMint: string; error: string | null; createdAt: string }[];
  killSwitch: boolean;
};

type UsersResponse = { count: number; users: AdminUser[] };

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-zinc-50 text-zinc-900">{children}</main>;
}

function ErrorScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <Shell>
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
          <p className="mt-2 text-sm text-rose-600">{detail}</p>
        </div>
      </div>
    </Shell>
  );
}

export default async function Admin() {
  await connection();

  if (!backendConfigured) {
    return (
      <ErrorScreen
        title="Backend not configured"
        detail="Set BACKEND_URL (plus ADMIN_USER / ADMIN_PASSWORD) in this app's environment."
      />
    );
  }

  const [dashRes, usersRes] = await Promise.all([
    backendFetch("/admin/dashboard").catch(() => null),
    backendFetch("/admin/users").catch(() => null),
  ]);

  if (!dashRes || !dashRes.ok) {
    return (
      <ErrorScreen
        title="Backend unreachable"
        detail={`Could not reach the backend at BACKEND_URL${dashRes ? ` (HTTP ${dashRes.status})` : ""}.`}
      />
    );
  }

  const { stats: s, pool, pendingWithdrawals, recentFailed, killSwitch } = (await dashRes.json()) as Dashboard;
  const users = usersRes && usersRes.ok ? ((await usersRes.json()) as UsersResponse).users : [];

  const statTiles: { label: string; value: number; tone: string }[] = [
    { label: "Users", value: s.users, tone: "text-zinc-900" },
    { label: "Active follows", value: s.follows, tone: "text-emerald-600" },
    { label: "Pending orders", value: s.pending, tone: "text-amber-600" },
    { label: "Pending withdrawals", value: s.withdrawals, tone: "text-amber-600" },
    { label: "Failed (24h)", value: s.failed24h, tone: "text-rose-600" },
  ];

  return (
    <Shell>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900 text-sm font-bold text-white">
              P
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight">P.R.I.M.E Admin</h1>
              <p className="text-xs text-zinc-500">Copy-trade control panel</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
                killSwitch
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-zinc-100 text-zinc-500 ring-zinc-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${killSwitch ? "bg-emerald-500" : "bg-zinc-400"}`} />
              Trading {killSwitch ? "enabled" : "disabled"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200">
              Backend {backendConfigured ? "online" : "offline"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {statTiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-zinc-500">{t.label}</p>
              <p className={`mt-1 font-mono text-2xl font-semibold ${t.tone}`}>{t.value}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <UsersPanel users={users} />

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900">Pending withdrawals</h2>
                <span className="text-xs text-zinc-500">
                  Pay from the pool wallet, paste the tx hash, then approve. Rejecting refunds the balance.
                </span>
              </div>
              <WithdrawalsTable rows={pendingWithdrawals} />
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-zinc-900">Pool trading wallet</h2>
              {pool.address ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                    <code className="truncate font-mono text-[11px] text-zinc-600">{pool.address}</code>
                    <CopyButton value={pool.address} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-zinc-50 py-2">
                      <p className="text-[11px] text-zinc-500">On-chain</p>
                      <p className="font-mono text-sm font-semibold">{pool.balanceSol} SOL</p>
                    </div>
                    <div className="rounded-lg bg-zinc-50 py-2">
                      <p className="text-[11px] text-zinc-500">User liabilities</p>
                      <p className="font-mono text-sm font-semibold">{pool.liabilitySol} SOL</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    All live copy-trades sign here. Point <code>OPERATOR_SOL_ADDRESS</code> at it so swept
                    deposits fund trading.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">Not configured — live copy-trades cannot run.</p>
              )}
              <div className="mt-3">
                <PoolWalletForm hasWallet={!!pool.address} />
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-zinc-900">Recent failures</h2>
              {recentFailed.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">None. 🎉</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recentFailed.map((o) => (
                    <li key={o.id} className="rounded-lg bg-zinc-50 px-2.5 py-2">
                      <div className="flex items-center justify-between text-[11px] font-medium text-zinc-600">
                        <span>
                          {o.side} · {o.tokenMint.slice(0, 8)}…
                        </span>
                        <span className="font-mono text-zinc-400">{o.createdAt.slice(5, 16).replace("T", " ")}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-rose-500">{(o.error ?? "").slice(0, 160)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </Shell>
  );
}
