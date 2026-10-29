import type { PlanType } from "../types";

/**
 * Wolf pack ranks, ordered lowest → highest.
 * Alpha leads the pack; Omega is the entry rank.
 */
export const PLAN_ORDER: PlanType[] = ["OMEGA", "GAMMA", "BETA", "ALPHA"];

export type PlanDurationDays = 14 | 30;

export type WolfPlanConfig = {
  /** Internal rank key (matches PlanType). */
  name: PlanType;
  /** User-facing rank name. */
  displayName: string;
  /** Short emblem used in bot copy. */
  emoji: string;
  /** Subscription price in whole USDT (for 30 days default). 0n for the free rank. */
  priceUsdt: bigint;
  /** Subscription length in days. 0 for the free rank. */
  durationDays: number;
  /** Available subscription durations and prices in whole USDT. */
  durations: Record<PlanDurationDays, { priceUsdt: bigint; label: string }>;
  /** How many coin picks the rank unlocks per day. */
  maxPicksPerDay: number;
  /** Potential ROI band shown to users — never a guarantee. */
  roiRange: string;
  /** One-line pitch for the rank. */
  tagline: string;
  /** Bullet list shown on the plan card. */
  features: string[];
  /** Call-to-action label. */
  cta: string;
  /** Risk framing used on pick messages. */
  risk: string;
};

export const WOLF_PLANS: Record<PlanType, WolfPlanConfig> = {
  OMEGA: {
    name: "OMEGA",
    displayName: "Omega Wolf",
    emoji: "🐺",
    priceUsdt: 0n,
    durationDays: 0,
    durations: {
      14: { priceUsdt: 0n, label: "Free (Unlimited)" },
      30: { priceUsdt: 0n, label: "Free (Unlimited)" },
    },
    maxPicksPerDay: 1,
    roiRange: "+5% – +10%",
    tagline: "Entry rank. I hunt your first high-probability setup.",
    features: ["1 Daily Coin Pick", "Basic Market Scan", "Entry Suggestion", "View Only Access"],
    cta: "Join The Pack",
    risk: "Slightly Higher",
  },
  GAMMA: {
    name: "GAMMA",
    displayName: "Gamma Wolf",
    emoji: "🐺",
    priceUsdt: 29n,
    durationDays: 30,
    durations: {
      14: { priceUsdt: 15n, label: "14 Days" },
      30: { priceUsdt: 29n, label: "30 Days" },
    },
    maxPicksPerDay: 3,
    roiRange: "+10% – +15%",
    tagline: "Stronger hunts. Better setups with defined targets.",
    features: [
      "3 Picks/Day",
      "Entry • TP • SL",
      "Volume & Liquidity Filter",
      "Smarter Scan",
      "Faster Picks",
    ],
    cta: "Become Gamma Wolf",
    risk: "Medium",
  },
  BETA: {
    name: "BETA",
    displayName: "Beta Wolf",
    emoji: "🐺",
    priceUsdt: 59n,
    durationDays: 30,
    durations: {
      14: { priceUsdt: 30n, label: "14 Days" },
      30: { priceUsdt: 59n, label: "30 Days" },
    },
    maxPicksPerDay: 5,
    roiRange: "+15% – +20%",
    tagline: "Second-in-command. Early to the strongest plays.",
    features: [
      "5 Picks/Day",
      "Early Alerts",
      "Stricter Safety Check",
      "Tight Liquidity Filter",
      "Higher Conviction Picks",
      "Priority Access",
    ],
    cta: "Become Beta Wolf",
    risk: "Low-Medium",
  },
  ALPHA: {
    name: "ALPHA",
    displayName: "Alpha Wolf",
    emoji: "👑",
    priceUsdt: 149n,
    durationDays: 30,
    durations: {
      14: { priceUsdt: 79n, label: "14 Days" },
      30: { priceUsdt: 149n, label: "30 Days" },
    },
    maxPicksPerDay: 10,
    roiRange: "+20% – +30%",
    tagline: "Pack leader. First to hunt the biggest opportunities.",
    features: [
      "VIP Priority Picks",
      "Highest Conviction Setups",
      "First Access To Picks",
      "Ultra-Stricter Filters",
      "Priority Alerts",
      "Apex Pack Access",
    ],
    cta: "Claim Alpha Rank",
    risk: "Calculated",
  },
};

/** Resolve a plan key to its config, falling back to the entry rank. */
export function getPlan(key: string | null | undefined): WolfPlanConfig {
  const k = (key ?? "").toUpperCase() as PlanType;
  return WOLF_PLANS[k] ?? WOLF_PLANS.OMEGA;
}

/** User-facing rank name. */
export function getPlanName(key: string | null | undefined): string {
  return getPlan(key).displayName;
}

/** Numeric rank (0 = Omega … 3 = Alpha) for comparisons and gating. */
export function planRank(key: string | null | undefined): number {
  return PLAN_ORDER.indexOf(getPlan(key).name);
}

/** True when `plan` is at least as strong as `min`. */
export function planAtLeast(plan: string | null | undefined, min: PlanType): boolean {
  return planRank(plan) >= planRank(min);
}

/** Get price for a plan and duration tier. */
export function getPlanPrice(plan: PlanType, days: PlanDurationDays): bigint {
  const p = getPlan(plan);
  if (p.name === "OMEGA") return 0n;
  return p.durations[days]?.priceUsdt ?? p.priceUsdt;
}
