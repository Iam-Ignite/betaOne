import { db, env } from "@copytrade/core";

const JUPITER_API_BASE = "https://api.jup.ag";
const TRADING_UPDATE_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const CACHED_PICKS_KEY = "real_trading_picks";
const CACHED_PICKS_EXPIRY_KEY = "real_trading_picks_expiry";

/** Jupiter trending token response type */
interface JupiterTrendingToken {
  mint: string;
  symbol: string;
  name: string;
  logoURI?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  mcap?: number;
  liquidity?: number;
  organicScore?: number;
  audit?: { isSus?: boolean };
  holderChange24h?: number;
}

/** Jupiter trending API response type */
interface JupiterTrendingResponse {
  tokens?: JupiterTrendingToken[];
  data?: JupiterTrendingToken[];
}

/** Jupiter price API response type */
interface JupiterPriceResponse {
  data?: Record<string, { usdPrice?: number; priceChange24h?: number; [k: string]: unknown }>;
  [mint: string]: { usdPrice?: number; priceChange24h?: number; [k: string]: unknown } | undefined;
}

/** Internal pick template (matches signals.ts) */
export type PickTemplate = {
  ticker: string;
  name: string;
  mint: string;
  entry: number;
  tp1: number;
  tp2: number;
  sl: number;
  reason: string;
};

/** Fetch trending tokens from Jupiter API */
async function fetchTrendingTokens(category: "toptrending" | "toptraded" | "toporganicscore" = "toptrending", interval: "5m" | "1h" | "6h" | "24h" = "1h", limit = 50): Promise<JupiterTrendingToken[]> {
  const apiKey = env.JUPITER_API_KEY;
  if (!apiKey) {
    console.warn("[RealTokenPicks] JUPITER_API_KEY not configured, using fallback");
    return [];
  }

  try {
    const url = `${JUPITER_API_BASE}/tokens/v2/${category}/${interval}?limit=${limit}`;
    const response = await fetch(url, {
      headers: { "x-api-key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`Jupiter trending API error: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as JupiterTrendingResponse;
    return data.tokens ?? data.data ?? [];
  } catch (e) {
    console.error("[RealTokenPicks] Failed to fetch trending tokens:", e);
    return [];
  }
}

/** Fetch prices for multiple mints from Jupiter Price API */
async function fetchTokenPrices(mints: string[]): Promise<Map<string, number>> {
  const apiKey = env.JUPITER_API_KEY;
  if (!apiKey || mints.length === 0) return new Map();

  // Jupiter price API accepts up to 50 tokens per request
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 50) {
    chunks.push(mints.slice(i, i + 50));
  }

  const priceMap = new Map<string, number>();

  for (const chunk of chunks) {
    try {
      const url = `${JUPITER_API_BASE}/price/v3?ids=${chunk.join(",")}`;
      const response = await fetch(url, { headers: { "x-api-key": apiKey } });
      if (!response.ok) continue;

      const data = (await response.json()) as JupiterPriceResponse;
      // Response format: { data: { [mint]: { usdPrice, priceChange24h, ... } } }
      const tokensData = data.data ?? data;
      for (const [mint, info] of Object.entries(tokensData)) {
        if (info && typeof info === "object" && "usdPrice" in info && info.usdPrice !== undefined) {
          priceMap.set(mint, info.usdPrice);
        }
      }
    } catch (e) {
      console.error("[RealTokenPicks] Price fetch error for chunk:", e);
    }
  }

  return priceMap;
}

/** Filter and score tokens for trading picks */
function scoreAndFilterTokens(tokens: JupiterTrendingToken[], prices: Map<string, number>): JupiterTrendingToken[] {
  const now = Date.now();

  return tokens
    .filter(t => {
      // Basic filters
      if (t.audit?.isSus) return false; // Skip suspicious tokens
      if (!t.mint || !t.symbol) return false;
      if (t.organicScore !== undefined && t.organicScore < 30) return false; // Low quality
      if (t.liquidity !== undefined && t.liquidity < 10000) return false; // Low liquidity
      return true;
    })
    .map(t => ({
      ...t,
      price: prices.get(t.mint) ?? t.price ?? 0,
      // Compute a composite score for ranking
      _score: computeTokenScore(t),
    }))
    .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
    .slice(0, 20); // Top 20 candidates
}

/** Compute a quality score for a token */
function computeTokenScore(t: JupiterTrendingToken): number {
  let score = 0;

  // Organic score (0-100) - weight 40%
  if (t.organicScore !== undefined) score += t.organicScore * 0.4;

  // Liquidity - weight 20% (log scale)
  if (t.liquidity !== undefined && t.liquidity > 0) {
    score += Math.min(Math.log10(t.liquidity) * 10, 50) * 0.2;
  }

  // 24h volume - weight 15%
  if (t.volume24h !== undefined && t.volume24h > 0) {
    score += Math.min(Math.log10(t.volume24h) * 5, 30) * 0.15;
  }

  // Holder growth - weight 10%
  if (t.holderChange24h !== undefined && t.holderChange24h > 0) {
    score += Math.min(t.holderChange24h * 2, 20) * 0.1;
  }

  // Price momentum - weight 15%
  if (t.priceChange24h !== undefined) {
    score += Math.max(Math.min(t.priceChange24h, 50), -20) * 0.15;
  }

  return score;
}

/** Generate a trading pick from a real token */
function generatePickFromToken(token: JupiterTrendingToken): PickTemplate {
  const price = token.price ?? 0.001;
  const volatility = Math.abs(token.priceChange24h ?? 5) / 100; // Use 24h change as volatility proxy

  // Calculate entry, TP, SL based on current price and volatility
  // Entry: current price (or slight discount for buys)
  const entry = price;

  // TP1: 5-15% gain depending on volatility
  const tp1Pct = 0.05 + Math.min(volatility * 0.5, 0.10);
  const tp1 = entry * (1 + tp1Pct);

  // TP2: 10-25% gain
  const tp2Pct = 0.10 + Math.min(volatility, 0.15);
  const tp2 = entry * (1 + tp2Pct);

  // SL: 5-12% loss
  const slPct = 0.05 + Math.min(volatility * 0.3, 0.07);
  const sl = entry * (1 - slPct);

  // Generate reason based on token metrics
  let reason = "Trending on Jupiter with strong momentum.";
  if (token.organicScore !== undefined && token.organicScore > 70) {
    reason = "High organic score indicating genuine community interest.";
  } else if (token.liquidity !== undefined && token.liquidity > 100000) {
    reason = "Deep liquidity with rising volume.";
  } else if (token.holderChange24h !== undefined && token.holderChange24h > 10) {
    reason = "Rapid holder growth with accumulation pattern.";
  } else if (token.priceChange24h !== undefined && token.priceChange24h > 20) {
    reason = "Strong price momentum with breakout potential.";
  }

  return {
    ticker: `$${token.symbol.toUpperCase()}`,
    name: token.name,
    mint: token.mint,
    entry: Number(entry.toFixed(token.price && token.price < 0.01 ? 6 : 4)),
    tp1: Number(tp1.toFixed(token.price && token.price < 0.01 ? 6 : 4)),
    tp2: Number(tp2.toFixed(token.price && token.price < 0.01 ? 6 : 4)),
    sl: Number(sl.toFixed(token.price && token.price < 0.01 ? 6 : 4)),
    reason,
  };
}

let activeFetchPromise: Promise<PickTemplate[]> | null = null;

/** Get cached picks or fetch new ones */
export async function getRealTradingPicks(): Promise<PickTemplate[]> {
  if (activeFetchPromise) return activeFetchPromise;
  activeFetchPromise = (async () => {
    try {
      const [cachedPicks, cachedExpiry] = await Promise.all([
        db.setting.findUnique({ where: { key: CACHED_PICKS_KEY } }),
        db.setting.findUnique({ where: { key: CACHED_PICKS_EXPIRY_KEY } }),
      ]);

      const now = Date.now();
      const expiry = cachedExpiry ? parseInt(cachedExpiry.value, 10) : 0;

      // Return cached picks if still valid
      if (cachedPicks && cachedPicks.value && now < expiry) {
        try {
          return JSON.parse(cachedPicks.value) as PickTemplate[];
        } catch {
          // Fall through to fetch new
        }
      }

      // Fetch fresh trending tokens
      console.log("[RealTokenPicks] Fetching fresh trending tokens from Jupiter...");

      const [trending, topTraded] = await Promise.all([
        fetchTrendingTokens("toptrending", "1h", 30),
        fetchTrendingTokens("toptraded", "1h", 30),
      ]);

      // Combine and deduplicate
      const allTokens = [...trending, ...topTraded];
      const uniqueTokens = Array.from(
        new Map(allTokens.map(t => [t.mint, t])).values()
      );

      // Fetch prices for all tokens
      const mints = uniqueTokens.map(t => t.mint);
      const prices = await fetchTokenPrices(mints);

      // Score, filter, and generate picks
      const scoredTokens = scoreAndFilterTokens(uniqueTokens, prices);
      const picks = scoredTokens.map(generatePickFromToken);

      // Cache the picks for 3 hours
      await Promise.all([
        db.setting.upsert({
          where: { key: CACHED_PICKS_KEY },
          update: { value: JSON.stringify(picks) },
          create: { key: CACHED_PICKS_KEY, value: JSON.stringify(picks) },
        }),
        db.setting.upsert({
          where: { key: CACHED_PICKS_EXPIRY_KEY },
          update: { value: (now + TRADING_UPDATE_INTERVAL_MS).toString() },
          create: { key: CACHED_PICKS_EXPIRY_KEY, value: (now + TRADING_UPDATE_INTERVAL_MS).toString() },
        }),
      ]);

      console.log(`[RealTokenPicks] Generated ${picks.length} real trading picks`);
      return picks;
    } finally {
      activeFetchPromise = null;
    }
  })();
  return activeFetchPromise;
}

/** Get a random pick from real data (for trading status rotation) */
export async function getRandomRealPick(): Promise<PickTemplate> {
  const picks = await getRealTradingPicks();
  if (picks.length === 0) {
    // Fallback to a basic pick if API fails
    return {
      ticker: "$SOL",
      name: "Solana",
      mint: "So11111111111111111111111111111111111111112",
      entry: 180,
      tp1: 198,
      tp2: 216,
      sl: 165,
      reason: "Fallback: SOL major support holding with ecosystem growth.",
    };
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

/** Force refresh of real picks (called by 3-hour loop) */
export async function refreshRealTradingPicks(): Promise<PickTemplate[]> {
  const now = Date.now();
  await Promise.all([
    db.setting.upsert({
      where: { key: CACHED_PICKS_KEY },
      update: { value: "[]" },
      create: { key: CACHED_PICKS_KEY, value: "[]" },
    }),
    db.setting.upsert({
      where: { key: CACHED_PICKS_EXPIRY_KEY },
      update: { value: "0" },
      create: { key: CACHED_PICKS_EXPIRY_KEY, value: "0" },
    }),
  ]);
  return getRealTradingPicks();
}