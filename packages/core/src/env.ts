import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3001"),
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_RPC_URL: z.string().optional(),
  HELIUS_WEBHOOK_ID: z.string().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  JUPITER_API_KEY: z.string().optional(),
  EVM_USDT_NETWORK: z.string().default("BNB Smart Chain (BEP-20)"),
  EVM_RPC_URL: z.string().default("https://bsc.publicnode.com"),
  EVM_CHAIN_ID: z.coerce.number().default(56),
  EVM_USDT_ADDRESS: z.string().default("0x55d398326f99059fF775485246999027B3197955"),
  EVM_USDT_DECIMALS: z.coerce.number().default(18),
  EVM_EXPLORER_URL: z.string().default("https://bscscan.com"),
  EVM_GAS_SYMBOL: z.string().default("BNB"),
  WALLET_KEK_BASE64: z.string().optional(),
  ADMIN_USER: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  // Pooled custody: every deposit is swept from the user's pass-through address
  // into these operator-controlled wallets.
  OPERATOR_SOL_ADDRESS: z.string().optional(),
  OPERATOR_EVM_ADDRESS: z.string().optional(),
  // Optional second operator: `OPERATOR2_SHARE`% of each sweep goes here.
  OPERATOR2_SOL_ADDRESS: z.string().optional(),
  OPERATOR2_EVM_ADDRESS: z.string().optional(),
  OPERATOR2_SHARE: z.coerce.number().default(0),
  SWEEP_DEPOSITS: z.string().default("true"),
  TRADING_ENABLED: z.string().default("false"),
  LIVE_TRADING_ALLOWED: z.string().default("false"),
  // Simulate live copy-trades against the user's ledger (no chain, no pool key).
  // Set false to execute real pooled swaps once the pool wallet is funded.
  SIMULATE_TRADING: z.string().default("true"),
  MAX_LEADER_AGE_MS: z.coerce.number().default(45_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${details}`);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";
export const tradingEnabled = env.TRADING_ENABLED === "true";
export const liveTradingAllowed = env.LIVE_TRADING_ALLOWED === "true";

/** Throw a clear error when a provider var is used but not configured. */
export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) throw new Error(`${String(name)} is not configured`);
  return String(value);
}
