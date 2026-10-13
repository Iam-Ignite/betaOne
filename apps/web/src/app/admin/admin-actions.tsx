"use client";

import { useMemo, useState, useTransition, useCallback } from "react";
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

export type RecentFailure = {
  id: string;
  side: string;
  tokenMint: string;
  error: string | null;
  createdAt: string;
};

export type DashboardStats = {
  users: number;
  follows: number;
  pending: number;
  withdrawals: number;
  failed24h: number;
};

export type PoolWalletData = {
  address: string | null;
  balanceSol: string;
  liabilitySol: string;
};

const ASSETS = ["SOL", "USDT", "BNB"] as const;
type Asset = (typeof ASSETS)[number];

const shortId = (id: string, start = 6, end = 4) =>
  id.length > start + end ? `${id.slice(0, start)}…${id.slice(-end)}` : id;

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const timeAgo = (iso: string) => {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
};

/* ---------------------------------------------------------------- SVG Icons */

function iconCls(custom: string | undefined, defaultSize: string) {
  if (!custom) return `${defaultSize} shrink-0`;
  const hasW = custom.includes("w-") || custom.includes("size-");
  const hasH = custom.includes("h-") || custom.includes("size-");
  let s = custom;
  if (!hasW) s = `${defaultSize.split(" ")[0]} ${s}`;
  if (!hasH) s = `${defaultSize.split(" ")[1]} ${s}`;
  return `${s} shrink-0`;
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-3.5 h-3.5")} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-3.5 h-3.5")} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-3.5 h-3.5")} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconArrowUpRight({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={iconCls(className, "w-4 h-4")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}

/* ---------------------------------------------------------------- UI Primitives */

export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition active:scale-95 ${
        done
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
      } ${className}`}
      title="Copy to clipboard"
    >
      {done ? <IconCheck className="h-3 w-3 text-emerald-600" /> : <IconCopy className="h-3 w-3" />}
      <span>{done ? "Copied" : label}</span>
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  fullWidth = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; badge?: number | string }[];
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`inline-flex rounded-xl bg-zinc-100 p-1 ring-1 ring-inset ring-zinc-200/80 ${
        fullWidth ? "w-full" : ""
      }`}
    >
      {options.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] ${
              fullWidth ? "flex-1" : ""
            } ${
              isActive
                ? "bg-white text-zinc-900 shadow-sm ring-1 ring-black/5 font-semibold"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <span>{o.label}</span>
            {o.badge !== undefined && (
              <span
                className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-200 text-zinc-600"
                }`}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BalanceChip({ asset, label }: { asset: Asset; label: string }) {
  const tone: Record<Asset, { bg: string; text: string; ring: string }> = {
    SOL: { bg: "bg-violet-50/80", text: "text-violet-700", ring: "ring-violet-200" },
    USDT: { bg: "bg-emerald-50/80", text: "text-emerald-700", ring: "ring-emerald-200" },
    BNB: { bg: "bg-amber-50/80", text: "text-amber-700", ring: "ring-amber-200" },
  };
  const t = tone[asset];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-mono font-medium ring-1 ring-inset ${t.bg} ${t.text} ${t.ring}`}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70 font-sans font-semibold">{asset}</span>
    </span>
  );
}

function AddressRow({
  label,
  value,
  explorerUrl,
}: {
  label: string;
  value: string;
  explorerUrl?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 ring-1 ring-zinc-200">
          {label}
        </span>
        <code className="truncate font-mono text-[11px] text-zinc-700" title={value}>
          {shortId(value, 8, 6)}
        </code>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1 text-zinc-400 transition hover:bg-white hover:text-zinc-700"
            title="View on block explorer"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- KPI Metric Card */

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  tone,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sublabel?: string;
  tone: "zinc" | "emerald" | "amber" | "rose" | "violet";
  badge?: string;
  onClick?: () => void;
}) {
  const tones = {
    zinc: {
      bg: "bg-white",
      iconBg: "bg-zinc-100 text-zinc-700",
      num: "text-zinc-900",
      border: "border-zinc-200 hover:border-zinc-300",
    },
    emerald: {
      bg: "bg-white",
      iconBg: "bg-emerald-50 text-emerald-600",
      num: "text-emerald-700",
      border: "border-emerald-100/80 hover:border-emerald-200",
    },
    amber: {
      bg: "bg-white",
      iconBg: "bg-amber-50 text-amber-600",
      num: "text-amber-700",
      border: "border-amber-100/80 hover:border-amber-200",
    },
    rose: {
      bg: "bg-white",
      iconBg: "bg-rose-50 text-rose-600",
      num: "text-rose-700",
      border: "border-rose-100/80 hover:border-rose-200",
    },
    violet: {
      bg: "bg-white",
      iconBg: "bg-violet-50 text-violet-600",
      num: "text-violet-700",
      border: "border-violet-100/80 hover:border-violet-200",
    },
  };

  const t = tones[tone];

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      className={`group relative flex flex-col justify-between rounded-2xl border ${t.border} ${t.bg} p-4 shadow-sm transition-all hover:shadow-md ${
        onClick ? "cursor-pointer active:scale-[0.99]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${t.iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className={`font-mono text-2xl font-bold tracking-tight ${t.num}`}>{value}</p>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
            {badge}
          </span>
        )}
      </div>
      {sublabel && <p className="mt-1 text-[11px] text-zinc-400">{sublabel}</p>}
    </div>
  );
}

/* ------------------------------------------------------------- Users Panel */

export function UsersPanel({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FUNDED" | "ACTIVE" | "FROZEN" | "PENDING">("ALL");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = users;

    // Filter by query
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          u.telegramId.includes(q) ||
          (u.username ?? "").toLowerCase().includes(q) ||
          (u.wallet?.address ?? "").toLowerCase().includes(q)
      );
    }

    // Filter by category
    if (statusFilter === "FUNDED") {
      list = list.filter(
        (u) =>
          Number(u.labels.SOL) > 0 ||
          Number(u.labels.USDT) > 0 ||
          Number(u.labels.BNB) > 0
      );
    } else if (statusFilter === "ACTIVE") {
      list = list.filter((u) => u.follows.active > 0);
    } else if (statusFilter === "FROZEN") {
      list = list.filter((u) => u.status === "FROZEN");
    } else if (statusFilter === "PENDING") {
      list = list.filter((u) => u.pendingWithdrawals > 0);
    }

    return list;
  }, [users, query, statusFilter]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      {/* Header with Search and Stats */}
      <div className="border-b border-zinc-100 p-4 md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-900">User Management</h2>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                {users.length}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Manage accounts, deposit wallets, and trade balances
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-72">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search user, ID or address…"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 py-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter chips (horizontal scrollable on mobile) */}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
          {(
            [
              { key: "ALL", label: "All Users" },
              { key: "FUNDED", label: "Funded Balances" },
              { key: "ACTIVE", label: "Active Follows" },
              { key: "PENDING", label: "Pending Payout" },
              { key: "FROZEN", label: "Frozen" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`shrink-0 rounded-lg px-2.5 py-1 font-medium transition active:scale-95 ${
                statusFilter === f.key
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-400 shrink-0">
            {filtered.length} found
          </span>
        </div>
      </div>

      {/* Users list */}
      {filtered.length === 0 ? (
        <div className="p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            <IconSearch className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-zinc-800">No users match your criteria</p>
          <p className="mt-1 text-xs text-zinc-500">
            Try adjusting your query or resetting the filter tags.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {filtered.map((u) => {
            const isOpen = open === u.telegramId;
            const primaryBalance = u.labels.SOL !== "0.000" ? `${u.labels.SOL} SOL` : null;

            return (
              <li key={u.telegramId} className={`transition ${isOpen ? "bg-zinc-50/70" : ""}`}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : u.telegramId)}
                  className="flex w-full items-center gap-3 p-3.5 sm:p-4 text-left transition hover:bg-zinc-50/80 active:bg-zinc-100/50"
                >
                  {/* User Avatar */}
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 text-xs font-bold text-white shadow-sm">
                    {(u.username ?? u.telegramId).slice(0, 2).toUpperCase()}
                  </span>

                  {/* User Name & Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-zinc-900">
                        {u.username ? `@${u.username}` : `ID ${u.telegramId}`}
                      </span>

                      {u.status === "FROZEN" && (
                        <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-inset ring-rose-200">
                          FROZEN
                        </span>
                      )}

                      {u.pendingWithdrawals > 0 && (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                          {u.pendingWithdrawals} PENDING
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="font-mono">{u.telegramId}</span>
                      <span>•</span>
                      <span>joined {fmtDate(u.createdAt)}</span>
                    </div>
                  </div>

                  {/* Compact Mobile Balance Preview */}
                  {primaryBalance && (
                    <span className="rounded-lg bg-violet-50 px-2 py-0.5 text-[11px] font-mono font-medium text-violet-700 ring-1 ring-inset ring-violet-200 lg:hidden">
                      {primaryBalance}
                    </span>
                  )}

                  {/* Desktop Balance Chips */}
                  <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                    <BalanceChip asset="SOL" label={u.labels.SOL} />
                    <BalanceChip asset="USDT" label={u.labels.USDT} />
                    <BalanceChip asset="BNB" label={u.labels.BNB} />
                  </div>

                  {/* Follows Stats */}
                  <div className="hidden shrink-0 text-right text-xs text-zinc-600 md:block">
                    <span className="font-medium">{u.follows.active} active</span>
                    <span className="block text-[11px] text-zinc-400">
                      {u.follows.live} live / {u.follows.paper} paper
                    </span>
                  </div>

                  {/* Expand Chevron */}
                  <span
                    className={`shrink-0 rounded-lg p-1 text-zinc-400 transition-transform ${
                      isOpen ? "rotate-180 text-zinc-700 bg-zinc-200/50" : ""
                    }`}
                  >
                    <IconChevronDown className="h-4 w-4" />
                  </span>
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
    <div className="space-y-4 border-t border-zinc-200/80 bg-zinc-50/50 p-4 md:p-5">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Deposit Wallets */}
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
              <IconWallet className="h-3.5 w-3.5 text-zinc-500" />
              Deposit Addresses
            </h3>
            <span className="text-[10px] text-zinc-400">On-chain sweep wallets</span>
          </div>

          {user.wallet ? (
            <div className="space-y-1.5 pt-1">
              <AddressRow
                label="Solana"
                value={user.wallet.address}
                explorerUrl={`https://solscan.io/account/${user.wallet.address}`}
              />
              {user.wallet.evmAddress && (
                <AddressRow
                  label="EVM"
                  value={user.wallet.evmAddress}
                  explorerUrl={`https://bscscan.com/address/${user.wallet.evmAddress}`}
                />
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500">
              No wallet generated yet. Created automatically on first <code>/start</code>.
            </p>
          )}
        </div>

        {/* Portfolio & Follows */}
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs">
          <h3 className="text-xs font-semibold text-zinc-700">Portfolio &amp; Trading</h3>
          <div className="flex flex-wrap gap-2 pt-1">
            <div className="flex-1 min-w-[90px] rounded-lg bg-zinc-50 p-2 text-center ring-1 ring-zinc-200">
              <p className="text-[10px] font-medium text-zinc-500">SOL</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-violet-700">{user.labels.SOL}</p>
            </div>
            <div className="flex-1 min-w-[90px] rounded-lg bg-zinc-50 p-2 text-center ring-1 ring-zinc-200">
              <p className="text-[10px] font-medium text-zinc-500">USDT</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-emerald-700">{user.labels.USDT}</p>
            </div>
            <div className="flex-1 min-w-[90px] rounded-lg bg-zinc-50 p-2 text-center ring-1 ring-zinc-200">
              <p className="text-[10px] font-medium text-zinc-500">BNB</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-amber-700">{user.labels.BNB}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
            <span>Active Follows</span>
            <span className="font-medium">
              {user.follows.active} active ({user.follows.live} live / {user.follows.paper} paper)
            </span>
          </div>
        </div>
      </div>

      {/* Adjust Balance Form */}
      <AdjustBalanceForm user={user} />

      {/* Free-form message to this user */}
      <SendMessageForm telegramId={user.telegramId} />
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
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const body =
      mode === "percent"
        ? { telegramId: user.telegramId, asset, mode, action: "credit", amount: value.trim(), reason }
        : { telegramId: user.telegramId, asset, mode, action, amount: value.trim(), reason };

    try {
      const res = await fetch("/api/admin/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Balance update failed" });
        return;
      }
      setMsg({ ok: true, text: `Balance updated: ${data.balanceAfterLabel ?? data.balanceAfter}` });
      setValue("");
      setReason("");
      start(() => router.refresh());
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const presets = ["10", "25", "50", "-10", "-25", "-50"];

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3.5 md:p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-800">Adjust Trading Balance</h3>
        <span className="font-mono text-xs font-medium text-zinc-500">
          Current: <span className="font-bold text-zinc-900">{user.labels[asset]} {asset}</span>
        </span>
      </div>

      {/* Asset and Mode Selectors */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented
          value={asset}
          onChange={(v) => setAsset(v)}
          options={ASSETS.map((a) => ({ value: a, label: a }))}
        />
        <Segmented
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "amount", label: "Exact Amount" },
            { value: "percent", label: "Percentage %" },
          ]}
        />
        {mode === "amount" && (
          <Segmented
            value={action}
            onChange={(v) => setAction(v)}
            options={[
              { value: "set", label: "Set" },
              { value: "credit", label: "+ Add" },
              { value: "debit", label: "− Subtract" },
            ]}
          />
        )}
      </div>

      {/* Percentage quick pills */}
      {mode === "percent" && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-zinc-400 mr-1">Quick scale:</span>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setValue(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition active:scale-95 ${
                p.startsWith("-")
                  ? "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
              }`}
            >
              {p.startsWith("-") ? p : `+${p}`}%
            </button>
          ))}
        </div>
      )}

      {/* Inputs and Submit button */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder={mode === "percent" ? "e.g. 25 or -25" : `Amount in ${asset}`}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 pr-12 text-base md:text-sm outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">
            {mode === "percent" ? "%" : asset}
          </span>
        </div>

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason note (optional)"
          className="flex-1 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-base md:text-sm outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
        />

        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 active:scale-98 disabled:opacity-40"
        >
          {busy ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Applying…</span>
            </>
          ) : (
            <span>Apply Change</span>
          )}
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-lg p-2.5 text-xs font-medium ${
            msg.ok ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
          }`}
        >
          {msg.ok ? "✓ " : "✕ "}
          {msg.text}
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------- Send Message Form */

const MESSAGE_TEMPLATES = [
  {
    label: "Payment Confirmation",
    title: "System Update - Payment Confirmation",
    message:
      "Your withdrawal has been confirmed and the funds have been sent to your wallet. Please allow a few minutes for the network to confirm the transaction.",
  },
  {
    label: "Processing",
    title: "System Update - Withdrawal Processing",
    message:
      "Your withdrawal is currently being processed. This can take a little while; we'll follow up once it completes.",
  },
  {
    label: "On Hold",
    title: "System Update - Withdrawal On Hold",
    message:
      "Your withdrawal has been placed on hold pending a quick review. We'll update you as soon as it is released.",
  },
] as const;

export function SendMessageForm({
  telegramId,
  withdrawalId,
  context,
  defaultTitle = "System Update - Payment Confirmation",
  compact = false,
  onClose,
}: {
  telegramId?: string;
  withdrawalId?: string;
  context?: string;
  defaultTitle?: string;
  compact?: boolean;
  onClose?: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ telegramId, withdrawalId, title: title.trim(), message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to send message");
      setMsg(
        data.delivered
          ? { ok: true, text: "Message delivered to the user on Telegram." }
          : { ok: false, text: "Message saved, but delivery failed — the user may have blocked the bot." },
      );
      if (data.delivered) setMessage("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3.5 md:p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
          <IconSend className="h-3.5 w-3.5 text-zinc-500" />
          Send Message to User
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            Close
          </button>
        )}
      </div>

      {context && (
        <p className="rounded-lg bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-500">
          Re: {context}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-400 mr-1">Template:</span>
        {MESSAGE_TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => {
              setTitle(t.title);
              setMessage(t.message);
              setMsg(null);
            }}
            className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-200 active:scale-95"
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Message title (optional)"
        className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-base md:text-sm outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
      />

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={compact ? 3 : 4}
        placeholder="Type the message to send to the user…"
        className="w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-base md:text-sm outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
      />

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 active:scale-98 disabled:opacity-40"
        >
          {busy ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Sending…</span>
            </>
          ) : (
            <>
              <IconSend className="h-3.5 w-3.5" />
              <span>Send Message</span>
            </>
          )}
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-lg p-2.5 text-xs font-medium ${
            msg.ok
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
          }`}
        >
          {msg.ok ? "✓ " : "✕ "}
          {msg.text}
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------- Withdrawals Section */

export function WithdrawalsTable({ rows }: { rows: PendingWithdrawal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [messageFor, setMessageFor] = useState<string | null>(null);
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
      if (!res.ok) throw new Error(data.error ?? "Failed to process withdrawal");
      setConfirmReject(null);
      start(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pasteTx(id: string) {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setTx((p) => ({ ...p, [id]: text.trim() }));
      }
    } catch {
      /* clipboard read blocked */
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <IconCheck className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-zinc-900">All caught up!</h3>
        <p className="mt-1 text-xs text-zinc-500">
          There are no pending withdrawal requests waiting for approval.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {rows.map((r) => {
        const isRejecting = confirmReject === r.id;
        const isBusy = busy === r.id;
        const explorerUrl =
          r.asset === "SOL"
            ? `https://solscan.io/account/${r.toAddress}`
            : `https://bscscan.com/address/${r.toAddress}`;

        return (
          <div
            key={r.id}
            className="rounded-2xl border border-amber-200/80 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            {/* Top row: Amount, User, Date */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xl font-bold tracking-tight text-zinc-900">
                    {r.amountLabel}
                  </span>
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                    PENDING
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-zinc-400">
                  User: <span className="font-semibold text-zinc-700">{r.telegramId}</span> • {timeAgo(r.createdAt)} ({fmtDate(r.createdAt)})
                </p>
              </div>
            </div>

            {/* Recipient Address */}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 rounded bg-zinc-200 px-1 py-0.5 text-[10px] font-bold text-zinc-700">
                  TO
                </span>
                <code className="truncate font-mono text-[11px] text-zinc-700" title={r.toAddress}>
                  {r.toAddress}
                </code>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                  title="Check on explorer"
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                </a>
                <CopyButton value={r.toAddress} />
              </div>
            </div>

            {/* Action Form */}
            <div className="mt-3 space-y-2">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Paste on-chain payout transaction hash…"
                  value={tx[r.id] ?? ""}
                  onChange={(e) => setTx((p) => ({ ...p, [r.id]: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 py-2 pl-3 pr-16 font-mono text-base md:text-xs outline-none transition focus:border-zinc-400 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => pasteTx(r.id)}
                  className="absolute right-2 rounded-md bg-zinc-200 px-2 py-1 text-[10px] font-semibold text-zinc-700 transition hover:bg-zinc-300"
                >
                  Paste
                </button>
              </div>

              {/* Action buttons */}
              {isRejecting ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                  <p className="text-xs font-semibold text-rose-900">
                    Confirm rejection? This will refund {r.amountLabel} back to user {r.telegramId}&apos;s balance.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(r.id, "reject")}
                      className="flex-1 rounded-lg bg-rose-600 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {isBusy ? "Processing…" : "Yes, Reject & Refund"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmReject(null)}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => act(r.id, "paid")}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 active:scale-98 disabled:opacity-50"
                  >
                    {isBusy ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <IconCheck className="h-3.5 w-3.5" />
                    )}
                    <span>Approve &amp; Mark Paid</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmReject(r.id)}
                    className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 active:scale-98 disabled:opacity-50"
                  >
                    Reject…
                  </button>
                </div>
              )}

              {/* Optional follow-up message to the user about this withdrawal */}
              {messageFor === r.id ? (
                <SendMessageForm
                  withdrawalId={r.id}
                  context={`${r.amountLabel} → ${r.toAddress}`}
                  compact
                  onClose={() => setMessageFor(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMessageFor(r.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 active:scale-98"
                >
                  <IconSend className="h-3.5 w-3.5" />
                  <span>Message user</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- Pool Trading */

export function PoolWalletCard({
  pool,
}: {
  pool: PoolWalletData;
}) {
  const onChain = parseFloat(pool.balanceSol) || 0;
  const liability = parseFloat(pool.liabilitySol) || 0;
  const isSolvent = onChain >= liability;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <IconWallet className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Pool Trading Wallet</h2>
            <p className="text-[11px] text-zinc-500">Live copy-trading signer &amp; treasury</p>
          </div>
        </div>

        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
            pool.address
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
          }`}
        >
          {pool.address ? "Configured" : "Unset"}
        </span>
      </div>

      {pool.address ? (
        <div className="mt-4 space-y-3">
          {/* Address row */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 text-xs">
            <code className="truncate font-mono text-[11px] text-zinc-700" title={pool.address}>
              {pool.address}
            </code>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={`https://solscan.io/account/${pool.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md p-1 text-zinc-400 hover:bg-white hover:text-zinc-700"
                title="View on Solscan"
              >
                <IconExternalLink className="h-3.5 w-3.5" />
              </a>
              <CopyButton value={pool.address} />
            </div>
          </div>

          {/* Solvency meter */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-2.5">
              <p className="text-[11px] font-medium text-zinc-500">On-Chain Balance</p>
              <p className="font-mono text-base font-bold text-zinc-900">{pool.balanceSol} SOL</p>
            </div>
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-2.5">
              <p className="text-[11px] font-medium text-zinc-500">User Liabilities</p>
              <p className="font-mono text-base font-bold text-zinc-900">{pool.liabilitySol} SOL</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-lg p-2 text-[11px] font-medium ${
              isSolvent
                ? "bg-emerald-50/70 text-emerald-800"
                : "bg-amber-50/70 text-amber-800"
            }`}
          >
            <IconShield className="h-3.5 w-3.5 shrink-0" />
            <span>
              {isSolvent
                ? "100% Solvency: On-chain reserves cover all user balances."
                : `Caution: User liabilities exceed on-chain pool by ${(liability - onChain).toFixed(3)} SOL.`}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-800">
          Pool wallet is not set up. Copy-trades will not execute until a signing wallet is provided.
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-zinc-100">
        <PoolWalletForm hasWallet={!!pool.address} />
      </div>
    </section>
  );
}

export function PoolWalletForm({ hasWallet }: { hasWallet: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: "generate" | "import") {
    if (action === "import" && !confirm("Import this key? Live copy-trades will sign transactions from it.")) return;
    if (action === "generate" && hasWallet && !confirm("Replace current pool wallet with a new generated keypair?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/pool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, secret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Operation failed");
      setMsg({ ok: true, text: `Pool wallet updated: ${shortId(data.address, 6, 6)}` });
      setSecret("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-700">Wallet Key Management</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => run("generate")}
          className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-zinc-800 active:scale-95 disabled:opacity-50"
        >
          {busy ? "Working…" : "Generate New"}
        </button>
      </div>

      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <input
            type={showKey ? "text" : "password"}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 py-2 pl-3 pr-8 font-mono text-base md:text-xs outline-none transition focus:border-zinc-400 focus:bg-white"
            placeholder="Paste base58 private key to import…"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {secret && (
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showKey ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={busy || !secret}
          onClick={() => run("import")}
          className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-50 active:scale-95 disabled:opacity-50"
        >
          Import
        </button>
      </div>

      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-600 font-medium" : "text-rose-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Failures Section */

export function RecentFailuresCard({ items }: { items: RecentFailure[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <IconAlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Recent Order Failures</h2>
            <p className="text-[11px] text-zinc-500">Execution errors from copy engine</p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl bg-zinc-50/70 p-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <IconCheck className="h-5 w-5" />
          </div>
          <p className="mt-2 text-xs font-medium text-zinc-700">All copy orders executing smoothly</p>
          <p className="text-[11px] text-zinc-400">Zero errors in the recent execution log</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((o) => {
            const isExp = expandedId === o.id;
            return (
              <li
                key={o.id}
                onClick={() => setExpandedId(isExp ? null : o.id)}
                className="cursor-pointer rounded-xl border border-zinc-100 bg-zinc-50/60 p-2.5 transition hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        o.side === "BUY" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {o.side}
                    </span>
                    <a
                      href={`https://dexscreener.com/solana/${o.tokenMint}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-[11px] text-zinc-700 hover:underline flex items-center gap-0.5"
                    >
                      {shortId(o.tokenMint, 4, 4)}
                      <IconExternalLink className="h-3 w-3 text-zinc-400" />
                    </a>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400">{timeAgo(o.createdAt)}</span>
                </div>

                <p className={`mt-1 font-mono text-[11px] text-rose-600 ${isExp ? "whitespace-pre-wrap" : "line-clamp-2"}`}>
                  {o.error || "Unknown execution failure"}
                </p>

                {isExp && (
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-200/50 pt-1.5 text-[10px] text-zinc-400">
                    <span>Order: {shortId(o.id, 8, 6)}</span>
                    <CopyButton value={o.error || ""} label="Copy Error" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------------------------------------------------- Main Dashboard Layout */

export function AdminDashboardView({
  stats,
  pool,
  pendingWithdrawals,
  recentFailed,
  killSwitch,
  users,
}: {
  stats: DashboardStats;
  pool: PoolWalletData;
  pendingWithdrawals: PendingWithdrawal[];
  recentFailed: RecentFailure[];
  killSwitch: boolean;
  users: AdminUser[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "withdrawals" | "system">("overview");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 800);
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 pb-12" style={{ colorScheme: "light" }}>
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-700 text-sm font-black text-white shadow-xs">
              P
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight sm:text-base">Prime Console</h1>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
                  Admin
                </span>
              </div>
              <p className="hidden text-[11px] text-zinc-500 sm:block">
                Solana &amp; EVM Copy-trading Engine
              </p>
            </div>
          </div>

          {/* Right Status Indicators & Refresh */}
          <div className="flex items-center gap-2">
            {/* Trading Killswitch Status */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                killSwitch
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-zinc-100 text-zinc-600 ring-zinc-200"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  killSwitch ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
                }`}
              />
              <span className="hidden sm:inline">Trading</span> {killSwitch ? "Live" : "Paused"}
            </span>

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 transition hover:bg-zinc-50 active:scale-95"
              title="Refresh dashboard data"
            >
              <IconRefresh className={`h-4 w-4 ${isRefreshing ? "animate-spin text-zinc-900" : ""}`} />
            </button>
          </div>
        </div>

        {/* Mobile Navigation Tabs */}
        <div className="border-t border-zinc-100 px-4 py-2 sm:px-6 lg:hidden">
          <Segmented
            value={activeTab}
            onChange={(tab) => setActiveTab(tab)}
            fullWidth
            options={[
              { value: "overview", label: "Overview" },
              { value: "users", label: "Users", badge: users.length },
              {
                value: "withdrawals",
                label: "Payouts",
                badge: pendingWithdrawals.length > 0 ? pendingWithdrawals.length : undefined,
              },
              { value: "system", label: "Pool / System" },
            ]}
          />
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 space-y-6">
        {/* KPI Metrics Ribbon */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            icon={IconUsers}
            label="Total Users"
            value={stats.users}
            sublabel="Registered accounts"
            tone="zinc"
            onClick={() => setActiveTab("users")}
          />
          <StatCard
            icon={IconTrendingUp}
            label="Active Follows"
            value={stats.follows}
            sublabel="Live copy trades"
            tone="emerald"
            onClick={() => setActiveTab("users")}
          />
          <StatCard
            icon={IconClock}
            label="Pending Orders"
            value={stats.pending}
            sublabel="Awaiting on-chain swap"
            tone="amber"
          />
          <StatCard
            icon={IconArrowUpRight}
            label="Pending Payouts"
            value={stats.withdrawals}
            sublabel={stats.withdrawals > 0 ? "Action required" : "All cleared"}
            tone={stats.withdrawals > 0 ? "amber" : "zinc"}
            badge={stats.withdrawals > 0 ? `${stats.withdrawals} pending` : undefined}
            onClick={() => setActiveTab("withdrawals")}
          />
          <StatCard
            icon={IconAlertTriangle}
            label="Failures (24h)"
            value={stats.failed24h}
            sublabel={stats.failed24h === 0 ? "Zero errors" : "Review logs"}
            tone={stats.failed24h > 0 ? "rose" : "zinc"}
            onClick={() => setActiveTab("system")}
          />
        </section>

        {/* Desktop View: Full multi-column dashboard */}
        <div className="hidden lg:grid lg:grid-cols-3 lg:gap-6">
          {/* Main 2-columns (Users & Withdrawals) */}
          <div className="lg:col-span-2 space-y-6">
            <UsersPanel users={users} />

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Pending Withdrawals</h2>
                  <p className="text-xs text-zinc-500">
                    Send funds from the pool wallet, then verify with transaction signature
                  </p>
                </div>
                {pendingWithdrawals.length > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    {pendingWithdrawals.length} awaiting approval
                  </span>
                )}
              </div>
              <WithdrawalsTable rows={pendingWithdrawals} />
            </section>
          </div>

          {/* Right Column: Pool & Logs */}
          <div className="space-y-6">
            <PoolWalletCard pool={pool} />
            <RecentFailuresCard items={recentFailed} />
          </div>
        </div>

        {/* Mobile View: Tab-based interface to eliminate endless scrolling */}
        <div className="lg:hidden space-y-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {pendingWithdrawals.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-bold">
                        !
                      </span>
                      <div>
                        <h3 className="text-xs font-bold text-amber-900">
                          {pendingWithdrawals.length} Withdrawal Request{pendingWithdrawals.length > 1 ? "s" : ""}
                        </h3>
                        <p className="text-[11px] text-amber-700">Awaiting payout approval</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("withdrawals")}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs"
                    >
                      View &amp; Pay
                    </button>
                  </div>
                </div>
              )}

              <PoolWalletCard pool={pool} />
              <RecentFailuresCard items={recentFailed} />
            </div>
          )}

          {activeTab === "users" && (
            <div>
              <UsersPanel users={users} />
            </div>
          )}

          {activeTab === "withdrawals" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-base font-semibold text-zinc-900">Pending Withdrawals</h2>
                <span className="text-xs text-zinc-500">
                  {pendingWithdrawals.length} pending
                </span>
              </div>
              <WithdrawalsTable rows={pendingWithdrawals} />
            </div>
          )}

          {activeTab === "system" && (
            <div className="space-y-6">
              <PoolWalletCard pool={pool} />
              <RecentFailuresCard items={recentFailed} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
