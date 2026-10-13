import { connection } from "next/server";
import { backendFetch, backendConfigured } from "@/lib/backend";
import {
  AdminDashboardView,
  type AdminUser,
  type PendingWithdrawal,
  type RecentFailure,
  type DashboardStats,
  type PoolWalletData,
} from "./admin-actions";

// Admin is a live dashboard: render at request time (never cache).
export const instant = false;

type Dashboard = {
  stats: DashboardStats;
  pool: PoolWalletData;
  pendingWithdrawals: PendingWithdrawal[];
  recentFailed: RecentFailure[];
  killSwitch: boolean;
};

type UsersResponse = { count: number; users: AdminUser[] };

function ErrorScreen({ title, detail, hint }: { title: string; detail: string; hint?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50/80 px-4 py-12 text-zinc-900">
      <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-bold text-zinc-900">{title}</h1>
        <p className="mt-1.5 text-sm text-zinc-600 leading-relaxed">{detail}</p>
        {hint && (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-500 font-mono">
            {hint}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <a
            href="/admin"
            className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-center text-xs font-semibold text-white shadow-xs transition hover:bg-zinc-800"
          >
            Retry Connection
          </a>
        </div>
      </div>
    </main>
  );
}

export default async function Admin() {
  await connection();

  if (!backendConfigured) {
    return (
      <ErrorScreen
        title="Backend Not Configured"
        detail="The admin console requires the backend URL and admin authentication credentials to be configured in this environment."
        hint="Set BACKEND_URL, ADMIN_USER, and ADMIN_PASSWORD in apps/web environment variables."
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
        title="Backend Gateway Unreachable"
        detail={`Could not establish connection to the copy-trade backend service${dashRes ? ` (HTTP ${dashRes.status})` : ""}.`}
        hint="Verify that the backend server is running and accessible at the specified BACKEND_URL."
      />
    );
  }

  const { stats, pool, pendingWithdrawals, recentFailed, killSwitch } = (await dashRes.json()) as Dashboard;
  const users = usersRes && usersRes.ok ? ((await usersRes.json()) as UsersResponse).users : [];

  return (
    <AdminDashboardView
      stats={stats}
      pool={pool}
      pendingWithdrawals={pendingWithdrawals}
      recentFailed={recentFailed}
      killSwitch={killSwitch}
      users={users}
    />
  );
}
