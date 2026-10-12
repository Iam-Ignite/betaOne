# Solana Copy-Trading Telegram Bot with Next.js: Full Build Guide

A Telegram bot where users get their own Solana wallet, deposit funds, pick wallets (traders) to follow, and the bot automatically mirrors those traders' swaps. Built around the feature set in your screenshot: `/start`, `/help`, `/wallet`, `/balance`, `/withdraw`, `/deposit`, `/copytrade`.

> **Read this before writing code**
> - **I have not compiled or run this code.** It is a build plan with starter code. Pin versions after your first working install and test everything with paper trading before using real money.
> - **Marked "(verify)"** means I could not confirm that detail (exact field names, limits, versions). Check the provider docs.
> - **This design is custodial** (the bot creates and holds each user's keys), like the bot in your screenshot. If you get the key handling wrong, users lose money. Section 13 is mandatory reading, and section 17 covers legal exposure. Do not onboard real users' funds until both are handled.
> - **Copy trading loses money for many users.** You are always a few seconds behind the leader, and some wallets exist only to bait copiers. Be honest about this in your product copy.

---

## 1. What you are building

| Command (from your screenshot) | What it does | Section |
|---|---|---|
| `/start` | Create the user and a Solana wallet, show the menu | 9 |
| `/help` | List commands | 9 |
| `/wallet` | Show the user's wallet address | 9 |
| `/balance` | SOL and token balances (read live from chain) | 9 |
| `/deposit` | Show the deposit address and notify when funds arrive | 9, 11 |
| `/withdraw` | Send SOL to an external address (address, amount, PIN, confirm) | 9, 11 |
| `/copytrade` | Follow a wallet, set size and risk rules, turn copying on and off | 9, 10 |

**Key simplification:** each user's wallet *is* their deposit address. The balance is whatever is on-chain in that wallet, so you do **not** need an internal ledger of credits. Deposits are only detected to send a notification.

**v1 scope:** Solana only, SOL as the funding asset. The bot in your screenshot also shows a USDT address on an `0x` chain. That means a second chain, a second set of keys and a bridge or swap, so leave it for later.

---

## 2. Architecture

```
                         ┌──────────────────────────────┐
 Telegram ───webhook────►│  Next.js app (apps/web)      │
                         │  • /api/telegram  (bot)      │
                         │  • /api/helius    (events)   │
                         │  • /admin dashboard          │
                         │  • /mini  (optional Mini App)│
                         └───────┬───────────┬──────────┘
                                 │           │ writes rows
 Helius webhooks ────────────────┘           ▼
 (leader swaps)                      ┌───────────────┐
                                     │  Postgres     │  users, wallets (encrypted),
                                     │               │  follows, leader swaps,
                                     └───────▲───────┘  copy orders, withdrawals
                                             │ claims PENDING rows
                         ┌───────────────────┴──────────┐
                         │ Worker (apps/worker)         │  long-running Node process
                         │ • copy orders → Jupiter swap │  ONLY place that can
                         │ • withdrawals                │  decrypt private keys
                         │ • deposit/balance watcher    │
                         └───────────────┬──────────────┘
                                         ▼
                              Solana (Helius RPC + Jupiter)
                                         │
                              Telegram messages to users
```

### Why two apps (web and worker)?

Next.js on serverless hosting (Vercel and similar) is great for webhooks, the admin UI and a Mini App, but it is a poor place to run trade execution: functions have time limits, can be killed mid-request, and can run twice. A trade must never be sent twice. So:

- **`apps/web` (Next.js):** receives Telegram updates and Helius events, writes to Postgres, answers fast. It **cannot decrypt private keys**.
- **`apps/worker` (plain Node):** a small always-on process that claims pending orders from Postgres, signs, sends and records the result.
- **Postgres is the queue** (an "outbox"): the web app inserts `PENDING` rows, the worker claims them with `FOR UPDATE SKIP LOCKED`. One less service than Redis, and idempotency comes from unique constraints.

Splitting key access this way means a bug or compromise in the public web app does not automatically expose every user's keys.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript) |
| Monorepo | pnpm workspaces (optionally Turborepo) |
| Telegram | grammY |
| Database | Postgres (Neon, Supabase or Railway) + Prisma |
| Solana | `@solana/web3.js` (v1 API used below), `@solana/spl-token` |
| RPC and events | Helius (RPC + Enhanced Webhooks) |
| Swaps | Jupiter Swap API v2 (`/order` + `/execute`) |
| Crypto | Node `crypto` (AES-256-GCM envelope encryption) → AWS KMS or similar in production |
| Worker hosting | Railway, Fly.io, or a small VPS (Docker) |
| Web hosting | Vercel, or the same host as the worker |
| Validation | zod |
| Logging | pino (with redaction) + Sentry |

**Provider facts I checked (current docs):**
- Jupiter's Swap API v2 lives at `https://api.jup.ag/swap/v2`, and **all endpoints require an API key** in the `x-api-key` header (get it from the Jupiter developer portal). The default flow is `GET /order` (returns a quote plus an unsigned transaction and a `requestId`), you sign the transaction, then `POST /execute` with the signed transaction and `requestId`. Without a `taker` address you get a quote but no transaction, which is perfect for paper trading. The older v1 quote/swap API is described as superseded.
- Helius webhooks can be created through the API with `webhookURL`, `transactionTypes`, `accountAddresses`, `webhookType: "enhanced"` and an optional `authHeader`. Webhook changes can take up to about two minutes to take effect.

---

## 4. Accounts and keys you need

1. **Telegram bot:** message `@BotFather` → `/newbot`. Save the token. Set the command list and description.
2. **Helius account:** API key (RPC + webhooks). Check free-tier limits for webhooks and addresses **(verify)**.
3. **Jupiter API key** from the developer portal.
4. **Postgres** database (Neon, Supabase, Railway).
5. **A secrets manager / KMS** for production key encryption (AWS KMS, GCP KMS, or similar).
6. Hosting accounts for web and worker.

---

## 5. Repository setup

```bash
mkdir copytrade-bot && cd copytrade-bot
pnpm init
printf "packages:\n  - 'apps/*'\n  - 'packages/*'\n" > pnpm-workspace.yaml

# Next.js app
pnpm create next-app apps/web --ts --app --eslint --tailwind --src-dir --import-alias "@/*"

# Shared core package + worker
mkdir -p packages/core/src apps/worker/src scripts
```

Install dependencies:

```bash
# core (db, solana, jupiter, crypto, domain logic)
cd packages/core
pnpm init
pnpm add @prisma/client @solana/web3.js @solana/spl-token bs58 zod pino
pnpm add -D prisma typescript tsx @types/node

# web
cd ../../apps/web
pnpm add grammy @copytrade/core
# worker
cd ../worker
pnpm init
pnpm add @copytrade/core grammy
pnpm add -D tsx typescript @types/node
```
Set `"name": "@copytrade/core"` in `packages/core/package.json`, point `main`/`types` at the source or a build output, and reference it from the apps as `"@copytrade/core": "workspace:*"`. Enable `transpilePackages: ["@copytrade/core"]` in `next.config.ts` if you import TypeScript source directly.

### Folder structure

```
copytrade-bot/
├── pnpm-workspace.yaml
├── .env.example
├── packages/core/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── db.ts                  # Prisma client
│       ├── env.ts                 # validated env (zod)
│       ├── crypto.ts              # envelope encryption for wallet keys
│       ├── solana.ts              # connection, balances, keypair loading
│       ├── jupiter.ts             # /order + /execute
│       ├── helius.ts              # webhook management + swap parsing
│       ├── copy-engine.ts         # pure rules: should we copy, how much
│       ├── safety.ts              # token checks
│       ├── notify.ts              # Telegram Api sender
│       └── index.ts
├── apps/web/src/
│   ├── bot/                       # grammY bot (commands, flows)
│   │   ├── index.ts
│   │   ├── commands.ts
│   │   ├── flows.ts
│   │   └── ui.ts                  # keyboards, formatting
│   ├── app/
│   │   ├── api/telegram/route.ts  # Telegram webhook
│   │   ├── api/helius/route.ts    # Helius webhook
│   │   ├── admin/page.tsx         # admin dashboard
│   │   └── mini/page.tsx          # optional Telegram Mini App
│   └── middleware.ts              # protects /admin
├── apps/worker/src/
│   ├── index.ts                   # polling loop
│   ├── copy-orders.ts
│   ├── withdrawals.ts
│   └── deposits.ts
└── scripts/
    ├── set-webhook.ts             # Telegram setWebhook + commands
    └── create-helius-webhook.ts
```

---

## 6. Environment variables

`.env.example` (never commit real values):

```bash
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=          # random string, sent back by Telegram on every update
PUBLIC_BASE_URL=https://your-app.example.com

# Database
DATABASE_URL=

# Solana / Helius
HELIUS_API_KEY=
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
HELIUS_WEBHOOK_ID=                # set after creating the webhook
HELIUS_WEBHOOK_SECRET=            # random string, used as the webhook authHeader

# Jupiter
JUPITER_API_KEY=

# Key encryption
WALLET_KEK_BASE64=                # 32 random bytes, base64. DEV ONLY. Use a KMS in production.

# Admin
ADMIN_USER=
ADMIN_PASSWORD=

# Safety
TRADING_ENABLED=false             # global kill switch default
LIVE_TRADING_ALLOWED=false        # must be true before any non-paper order executes
```
Generate secrets with `openssl rand -base64 32`. **The web app should not receive `WALLET_KEK_BASE64` in production.** Only the worker should (see section 13).

---

## 7. Database schema (`packages/core/prisma/schema.prisma`)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum UserStatus { ACTIVE FROZEN }
enum Side { BUY SELL }
enum OrderStatus { PENDING PROCESSING SUBMITTED CONFIRMED SKIPPED FAILED }
enum WithdrawalStatus { PENDING PROCESSING SUBMITTED CONFIRMED FAILED }

model User {
  id          String       @id @default(cuid())
  telegramId  BigInt       @unique
  username    String?
  status      UserStatus   @default(ACTIVE)
  pinHash     String?
  pending     Json?                         // multi-step flow state: { action, step, data }
  createdAt   DateTime     @default(now())
  wallet      Wallet?
  follows     Follow[]
  withdrawals Withdrawal[]
}

model Wallet {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  address   String   @unique
  encrypted Json                              // envelope-encrypted secret key (see crypto.ts)
  lastKnownLamports BigInt @default(0)        // for deposit notifications
  createdAt DateTime @default(now())
}

model Trader {
  id        String       @id @default(cuid())
  address   String       @unique
  label     String
  active    Boolean      @default(true)
  createdAt DateTime     @default(now())
  follows   Follow[]
  swaps     LeaderSwap[]
}

model Follow {
  id          String   @id @default(cuid())
  userId      String
  traderId    String
  user        User     @relation(fields: [userId], references: [id])
  trader      Trader   @relation(fields: [traderId], references: [id])
  active      Boolean  @default(false)
  paper       Boolean  @default(true)         // paper mode by default
  buyLamports BigInt   @default(50000000)     // 0.05 SOL per copied buy
  maxLamports BigInt   @default(100000000)    // hard cap per trade
  slippageBps Int      @default(1000)
  copyBuys    Boolean  @default(true)
  copySells   Boolean  @default(true)
  strictSafety Boolean @default(true)         // require renounced mint/freeze authority
  createdAt   DateTime @default(now())
  orders      CopyOrder[]
  paperPositions PaperPosition[]
  @@unique([userId, traderId])
}

model LeaderSwap {
  id         String   @id @default(cuid())
  signature  String   @unique                 // idempotency: webhooks can be delivered more than once
  traderId   String
  trader     Trader   @relation(fields: [traderId], references: [id])
  side       Side
  tokenMint  String
  inputMint  String
  outputMint String
  inAmount   String                           // raw units as string (BigInt-safe)
  outAmount  String
  blockTime  DateTime
  createdAt  DateTime @default(now())
  orders     CopyOrder[]
}

model CopyOrder {
  id              String      @id @default(cuid())
  followId        String
  follow          Follow      @relation(fields: [followId], references: [id])
  swapId          String
  swap            LeaderSwap  @relation(fields: [swapId], references: [id])
  leaderSignature String
  side            Side
  tokenMint       String
  paper           Boolean
  status          OrderStatus @default(PENDING)
  inAmountRaw     String?
  outAmountRaw    String?
  requestId       String?                     // Jupiter requestId
  txSignature     String?
  skipReason      String?
  error           String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  @@unique([followId, leaderSignature])       // one order per follower per leader trade
  @@index([status, createdAt])
}

model PaperPosition {
  id         String @id @default(cuid())
  followId   String
  follow     Follow @relation(fields: [followId], references: [id])
  tokenMint  String
  amountRaw  String
  costLamports BigInt
  @@unique([followId, tokenMint])
}

model Withdrawal {
  id          String           @id @default(cuid())
  userId      String
  user        User             @relation(fields: [userId], references: [id])
  toAddress   String
  lamports    BigInt
  status      WithdrawalStatus @default(PENDING)
  txSignature String?
  error       String?
  createdAt   DateTime         @default(now())
  @@index([status, createdAt])
}

model Setting {
  key   String @id
  value String
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  action    String
  meta      Json?
  createdAt DateTime @default(now())
}
```

```bash
cd packages/core
npx prisma migrate dev --name init
```

---

## 8. Core library (`packages/core`)

### 8.1 `db.ts`
```ts
import { PrismaClient } from "@prisma/client";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
```
`BigInt` values do not serialize to JSON by default. Convert to strings before returning them from API routes.

### 8.2 `crypto.ts` (wallet key encryption)

Envelope encryption: each secret key is encrypted with its own random data key (DEK), and the DEK is encrypted with a master key (KEK). The version below reads the KEK from an env var for **development only**. In production, replace `wrapDek`/`unwrapDek` with calls to a KMS so the master key never exists in app memory, and grant the web app **encrypt-only** and the worker **decrypt** permission.

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Sealed = { iv: string; ct: string; tag: string };
export type EncryptedSecret = { v: 1; data: Sealed; dek: Sealed };

const b64 = (b: Buffer) => b.toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64");

function seal(key: Buffer, plaintext: Buffer): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}
function open(key: Buffer, s: Sealed): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, unb64(s.iv));
  d.setAuthTag(unb64(s.tag));
  return Buffer.concat([d.update(unb64(s.ct)), d.final()]);
}

// DEV ONLY: replace with KMS Encrypt / Decrypt calls.
function kek(): Buffer {
  const k = Buffer.from(process.env.WALLET_KEK_BASE64 ?? "", "base64");
  if (k.length !== 32) throw new Error("WALLET_KEK_BASE64 must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(secret: Uint8Array): EncryptedSecret {
  const dek = randomBytes(32);
  const data = seal(dek, Buffer.from(secret));
  const wrapped = seal(kek(), dek);
  dek.fill(0);
  return { v: 1, data, dek: wrapped };
}

export function decryptSecret(enc: EncryptedSecret): Uint8Array {
  const dek = open(kek(), enc.dek);
  try {
    return new Uint8Array(open(dek, enc.data));
  } finally {
    dek.fill(0);
  }
}
```
Rules: never log a secret key, never return one to the web layer, keep decrypted bytes in memory for as short a time as possible, and zero them when done.

### 8.3 `solana.ts`
```ts
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { decryptSecret, EncryptedSecret } from "./crypto";

export const conn = new Connection(process.env.HELIUS_RPC_URL!, "confirmed");

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const QUOTE_MINTS = new Set([WSOL, USDC, USDT]);

export const RESERVE_LAMPORTS = 10_000_000n; // keep 0.01 SOL for fees and new token account rent

export const fmtSol = (l: bigint | number) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);

export function newWallet() {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), secretKey: kp.secretKey };
}

export function loadKeypair(enc: EncryptedSecret): Keypair {
  return Keypair.fromSecretKey(decryptSecret(enc));
}

export async function getSolBalance(address: string): Promise<bigint> {
  return BigInt(await conn.getBalance(new PublicKey(address)));
}

export async function getTokenBalances(address: string) {
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), {
    programId: TOKEN_PROGRAM_ID,
  });
  return res.value
    .map((a) => {
      const i = a.account.data.parsed.info;
      return { mint: i.mint as string, raw: BigInt(i.tokenAmount.amount), ui: i.tokenAmount.uiAmountString as string };
    })
    .filter((t) => t.raw > 0n);
}

export async function getTokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}
```
Tokens that use the Token-2022 program are not returned by the classic `TOKEN_PROGRAM_ID` query. If you want to support them, query that program ID too.

### 8.4 `jupiter.ts` (Swap API v2)

```ts
const BASE = "https://api.jup.ag/swap/v2";
const headers = { "x-api-key": process.env.JUPITER_API_KEY! };

export type JupOrder = {
  requestId: string;
  transaction: string;           // base64, unsigned; "" or null if no taker or it could not be built
  inAmount?: string;
  outAmount?: string;
  [k: string]: unknown;
};

/** Without `taker` you get a quote but no transaction (use for paper trading). */
export async function getOrder(p: {
  inputMint: string; outputMint: string; amount: bigint; taker?: string; slippageBps?: number;
}): Promise<JupOrder> {
  const qs = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amount.toString(),
  });
  if (p.taker) qs.set("taker", p.taker);
  if (p.slippageBps) qs.set("slippageBps", String(p.slippageBps));   // (verify param name)
  const r = await fetch(`${BASE}/order?${qs}`, { headers });
  if (!r.ok) throw new Error(`Jupiter /order ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function executeOrder(signedTxBase64: string, requestId: string) {
  const r = await fetch(`${BASE}/execute`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: signedTxBase64, requestId }),
  });
  if (!r.ok) throw new Error(`Jupiter /execute ${r.status}: ${await r.text()}`);
  return r.json() as Promise<Record<string, any>>;     // inspect status/signature fields (verify)
}
```

Signing helper (worker only):

```ts
import { VersionedTransaction, Keypair } from "@solana/web3.js";

export function signOrderTx(order: JupOrder, kp: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([kp]);                                           // partial sign: Jupiter/market makers add theirs on /execute
  return Buffer.from(tx.serialize()).toString("base64");
}
```

### 8.5 `helius.ts`: parsing swaps and managing the webhook

```ts
import { QUOTE_MINTS, WSOL } from "./solana";

export type ParsedSwap = {
  signature: string; trader: string; side: "BUY" | "SELL";
  tokenMint: string; inputMint: string; outputMint: string;
  inAmount: string; outAmount: string; blockTime: Date;
};

/** Parse a Helius *enhanced* transaction of type SWAP. Field names follow Helius' enhanced format (verify against a real payload). */
export function parseSwap(tx: any): ParsedSwap | null {
  if (tx?.type !== "SWAP" || !tx.events?.swap) return null;
  const s = tx.events.swap;

  const input = s.tokenInputs?.[0]
    ? { mint: s.tokenInputs[0].mint as string, raw: String(s.tokenInputs[0].rawTokenAmount.tokenAmount) }
    : s.nativeInput ? { mint: WSOL, raw: String(s.nativeInput.amount) } : null;
  const output = s.tokenOutputs?.[0]
    ? { mint: s.tokenOutputs[0].mint as string, raw: String(s.tokenOutputs[0].rawTokenAmount.tokenAmount) }
    : s.nativeOutput ? { mint: WSOL, raw: String(s.nativeOutput.amount) } : null;
  if (!input || !output) return null;

  const inIsQuote = QUOTE_MINTS.has(input.mint);
  const outIsQuote = QUOTE_MINTS.has(output.mint);
  if (inIsQuote === outIsQuote) return null;           // token↔token or quote↔quote: ignore in v1

  return {
    signature: tx.signature,
    trader: tx.feePayer,
    side: inIsQuote ? "BUY" : "SELL",
    tokenMint: inIsQuote ? output.mint : input.mint,
    inputMint: input.mint, outputMint: output.mint,
    inAmount: input.raw, outAmount: output.raw,
    blockTime: new Date((tx.timestamp ?? Date.now() / 1000) * 1000),
  };
}
```
**Important:** `feePayer` is usually the trader, but not always (relayers, bots, multi-wallet setups). Match against your followed addresses using the webhook's account list and verify the trader is actually the owner of the swapped balances.

Webhook management (called from a script and from the worker when follows change):

```ts
const API = "https://api.helius.xyz/v0/webhooks";
const key = () => process.env.HELIUS_API_KEY!;

export async function createWebhook(addresses: string[]) {
  const r = await fetch(`${API}?api-key=${key()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookURL: `${process.env.PUBLIC_BASE_URL}/api/helius`,
      transactionTypes: ["SWAP"],
      accountAddresses: addresses,
      webhookType: "enhanced",
      authHeader: process.env.HELIUS_WEBHOOK_SECRET,
    }),
  });
  return r.json();
}

export async function setWebhookAddresses(webhookId: string, addresses: string[]) {
  // The update call replaces the webhook definition, so resend the full config. Changes can take ~2 minutes.
  const r = await fetch(`${API}/${webhookId}?api-key=${key()}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookURL: `${process.env.PUBLIC_BASE_URL}/api/helius`,
      transactionTypes: ["SWAP"],
      accountAddresses: addresses,
      webhookType: "enhanced",
      authHeader: process.env.HELIUS_WEBHOOK_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`Helius update failed: ${r.status}`);
}
```
Keep the full list of followed trader addresses derived from the database (all `Trader` rows that have at least one active follow) and push it whenever it changes. Do that from one place (the worker) so two requests do not overwrite each other.

### 8.6 `safety.ts`

```ts
import { PublicKey } from "@solana/web3.js";
import { conn } from "./solana";

export class SkipError extends Error {}

/** Basic checks. Many legitimate tokens have authorities, so make this per-follow configurable. */
export async function assertTokenSafe(mint: string) {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  const parsed = (info.value?.data as any)?.parsed?.info;
  if (!parsed) throw new SkipError("token mint could not be read");
  if (parsed.mintAuthority) throw new SkipError("mint authority is not renounced");
  if (parsed.freezeAuthority) throw new SkipError("freeze authority is set");
}
```
Add more over time: minimum liquidity, token age, holder concentration, honeypot simulation (simulate a sell), and Token-2022 extension checks (transfer fees, permanent delegate).

### 8.7 `copy-engine.ts` (pure logic, easy to unit test)

```ts
export type FollowRules = {
  buyLamports: bigint; maxLamports: bigint;
  copyBuys: boolean; copySells: boolean;
};

export type Plan =
  | { kind: "skip"; reason: string }
  | { kind: "buy"; lamports: bigint }
  | { kind: "sell"; fraction: number };       // v1: always 1.0 (sell our whole position)

export function planCopy(
  side: "BUY" | "SELL",
  rules: FollowRules,
  ctx: { solBalance: bigint; reserve: bigint; haveTokens: boolean },
): Plan {
  if (side === "BUY") {
    if (!rules.copyBuys) return { kind: "skip", reason: "buys disabled" };
    const spendable = ctx.solBalance - ctx.reserve;
    let amount = rules.buyLamports < rules.maxLamports ? rules.buyLamports : rules.maxLamports;
    if (amount > spendable) amount = spendable;
    if (amount <= 0n) return { kind: "skip", reason: "not enough SOL" };
    return { kind: "buy", lamports: amount };
  }
  if (!rules.copySells) return { kind: "skip", reason: "sells disabled" };
  if (!ctx.haveTokens) return { kind: "skip", reason: "no position to sell" };
  return { kind: "sell", fraction: 1 };
}
```
v1 sells your whole position whenever the leader sells any amount. Proportional selling needs the leader's pre-trade balance, so add it later.

### 8.8 `notify.ts`
```ts
import { Api } from "grammy";
const api = new Api(process.env.TELEGRAM_BOT_TOKEN!);

export async function notify(telegramId: bigint | number, html: string) {
  try {
    await api.sendMessage(Number(telegramId), html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    console.error("notify failed", e);          // users may have blocked the bot; never crash on this
  }
}
```
Telegram limits how fast a bot can send messages. If a popular leader has thousands of followers, throttle notifications (a small queue or `p-limit`) or you will get rate-limit errors.

### 8.9 `index.ts`
Re-export everything: `export * from "./db"; export * from "./crypto"; ...`

---

## 9. The Telegram bot (`apps/web/src/bot`)

### 9.1 Setup and user loading (`bot/index.ts`)

```ts
import { Bot, Context } from "grammy";
import { db, newWallet, encryptSecret } from "@copytrade/core";
import type { User, Wallet } from "@prisma/client";

export type Ctx = Context & { user: User & { wallet: Wallet | null } };
export const bot = new Bot<Ctx>(process.env.TELEGRAM_BOT_TOKEN!);

// Only private chats; never let the bot act inside groups.
bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  let user = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, include: { wallet: true } });
  if (!user) {
    user = await db.user.create({
      data: { telegramId: BigInt(ctx.from.id), username: ctx.from.username },
      include: { wallet: true },
    });
  }
  if (!user.wallet) {
    const w = newWallet();
    const wallet = await db.wallet.create({
      data: { userId: user.id, address: w.address, encrypted: encryptSecret(w.secretKey) as any },
    });
    w.secretKey.fill(0);
    user = { ...user, wallet };
  }
  if (user.status === "FROZEN") return ctx.reply("Your account is paused. Contact support.");
  ctx.user = user;
  await next();
});

import "./commands";
import "./flows";
```
In production the **web app should not be able to encrypt with the real KEK either** unless you use KMS with encrypt-only permissions. If that is not possible, have the worker create wallets (the web app enqueues "create wallet", the worker fills it in) so key material is only ever created and used in the worker.

### 9.2 Commands (`bot/commands.ts`)

```ts
import { InlineKeyboard } from "grammy";
import { bot } from "./index";
import { db, getSolBalance, getTokenBalances, fmtSol } from "@copytrade/core";

export const COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Get help" },
  { command: "wallet", description: "View wallet addresses" },
  { command: "balance", description: "Check your balance" },
  { command: "withdraw", description: "Withdraw funds" },
  { command: "deposit", description: "Deposit funds" },
  { command: "copytrade", description: "Copytrade from your favourite traders" },
];

const mainMenu = new InlineKeyboard()
  .text("💰 Balance", "balance").text("📥 Deposit", "deposit").row()
  .text("📤 Withdraw", "withdraw").text("📈 Copytrade", "copytrade");

bot.command("start", (ctx) =>
  ctx.reply(
    "🚀 <b>Copytrading bot</b>\n\nFollow a wallet and the bot mirrors its swaps from your own wallet.\n\n" +
    "⚠️ Trading is risky and you can lose everything you deposit. Start in paper mode.",
    { parse_mode: "HTML", reply_markup: mainMenu },
  ));

bot.command("help", (ctx) =>
  ctx.reply(COMMANDS.map((c) => `/${c.command}: ${c.description}`).join("\n")));

bot.command("wallet", (ctx) =>
  ctx.reply(`Your Solana wallet:\n<code>${ctx.user.wallet!.address}</code>`, { parse_mode: "HTML" }));

async function sendBalance(ctx: any) {
  const addr = ctx.user.wallet!.address;
  const [sol, tokens] = await Promise.all([getSolBalance(addr), getTokenBalances(addr)]);
  const lines = tokens.slice(0, 15).map((t) => `• <code>${t.mint.slice(0, 6)}…</code> ${t.ui}`);
  await ctx.reply(`<b>SOL:</b> ${fmtSol(sol)}\n${lines.join("\n") || "No tokens"}`, { parse_mode: "HTML" });
}
bot.command("balance", sendBalance);
bot.callbackQuery("balance", async (ctx) => { await ctx.answerCallbackQuery(); await sendBalance(ctx); });

async function sendDeposit(ctx: any) {
  const addr = ctx.user.wallet!.address;
  await ctx.reply(
    `📥 <b>Deposit SOL</b>\nSend SOL on the <b>Solana</b> network to:\n<code>${addr}</code>\n\n` +
    `Sending anything on another network will lose it. I will message you when it arrives.`,
    { parse_mode: "HTML" });
}
bot.command("deposit", sendDeposit);
bot.callbackQuery("deposit", async (ctx) => { await ctx.answerCallbackQuery(); await sendDeposit(ctx); });
```
Tapping a `<code>` block in Telegram copies it, so you do not need a separate "copy address" button.

### 9.3 Multi-step flows without server memory (`bot/flows.ts`)

Webhook handlers are stateless, so keep flow state in the database (`User.pending`) rather than in memory.

```ts
import { PublicKey } from "@solana/web3.js";
import { bot } from "./index";
import { db, fmtSol, getSolBalance, RESERVE_LAMPORTS } from "@copytrade/core";
import { InlineKeyboard } from "grammy";
import { hash, verify } from "argon2";            // pnpm add argon2

const setPending = (id: string, pending: any) => db.user.update({ where: { id }, data: { pending } });
const isAddress = (s: string) => { try { new PublicKey(s); return s.length >= 32; } catch { return false; } };

/* ---------- /withdraw ---------- */
bot.command("withdraw", async (ctx) => {
  if (!ctx.user.pinHash) {
    await setPending(ctx.user.id, { action: "set_pin" });
    return ctx.reply("🔐 First set a withdrawal PIN (4–8 digits). I'll delete your message right after.");
  }
  await setPending(ctx.user.id, { action: "withdraw", step: "address" });
  return ctx.reply("Send the destination <b>Solana address</b>:", { parse_mode: "HTML" });
});
bot.callbackQuery("withdraw", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Use /withdraw"); });

bot.on("message:text", async (ctx, next) => {
  const p = ctx.user.pending as any;
  if (!p) return next();
  const text = ctx.message.text.trim();

  if (p.action === "set_pin") {
    await ctx.deleteMessage().catch(() => {});
    if (!/^\d{4,8}$/.test(text)) return ctx.reply("PIN must be 4–8 digits. Try again.");
    await db.user.update({ where: { id: ctx.user.id }, data: { pinHash: await hash(text), pending: undefined } });
    return ctx.reply("✅ PIN saved. Run /withdraw again.");
  }

  if (p.action === "withdraw") {
    if (p.step === "address") {
      if (!isAddress(text)) return ctx.reply("That is not a valid Solana address. Try again or send /cancel.");
      await setPending(ctx.user.id, { action: "withdraw", step: "amount", to: text });
      return ctx.reply("How much SOL? (number, or <code>max</code>)", { parse_mode: "HTML" });
    }
    if (p.step === "amount") {
      const bal = await getSolBalance(ctx.user.wallet!.address);
      const fee = 5000n;
      let lamports: bigint;
      if (text.toLowerCase() === "max") lamports = bal - fee;
      else {
        const n = Number(text);
        if (!isFinite(n) || n <= 0) return ctx.reply("Send a positive number.");
        lamports = BigInt(Math.round(n * 1e9));
      }
      if (lamports <= 0n || lamports + fee > bal) return ctx.reply("Not enough SOL (fees included).");
      await setPending(ctx.user.id, { action: "withdraw", step: "pin", to: p.to, lamports: lamports.toString() });
      return ctx.reply(`Confirm: send <b>${fmtSol(lamports)} SOL</b> to\n<code>${p.to}</code>\n\nEnter your PIN to confirm (I'll delete the message), or /cancel.`,
        { parse_mode: "HTML" });
    }
    if (p.step === "pin") {
      await ctx.deleteMessage().catch(() => {});
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!(await verify(user.pinHash!, text))) {
        // TODO: count failures and lock after 5 attempts
        return ctx.reply("❌ Wrong PIN.");
      }
      // Daily limit check (example): sum of last 24h withdrawals
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const agg = await db.withdrawal.aggregate({ _sum: { lamports: true }, where: { userId: user.id, createdAt: { gte: since } } });
      const used = agg._sum.lamports ?? 0n;
      const DAILY_LIMIT = 5_000_000_000n;           // 5 SOL: tune per tier
      if (used + BigInt(p.lamports) > DAILY_LIMIT) { await setPending(user.id, undefined); return ctx.reply("Daily withdrawal limit reached."); }

      await db.withdrawal.create({ data: { userId: user.id, toAddress: p.to, lamports: BigInt(p.lamports) } });
      await db.auditLog.create({ data: { userId: user.id, action: "withdraw_requested", meta: { to: p.to, lamports: p.lamports } } });
      await setPending(user.id, undefined);
      return ctx.reply("⏳ Withdrawal queued. I'll message you with the result.");
    }
  }
  return next();
});

bot.command("cancel", async (ctx) => { await setPending(ctx.user.id, undefined); return ctx.reply("Cancelled."); });
```
(`pending: undefined` in Prisma leaves a column unchanged. To clear a JSON column, use `Prisma.DbNull` instead.) Typing a PIN into a chat is weaker than a Mini App input, because the message exists in Telegram's history until deleted. Move PIN entry to the Mini App (section 10.4) when you can.

Extra withdrawal protections to add before real money: a cooldown (for example 10 to 60 minutes) before the first withdrawal to a new address, a saved-address allowlist, a notification on every withdrawal, and a freeze if the user reports their account compromised.

### 9.4 `/copytrade` flow

```ts
bot.command("copytrade", async (ctx) => {
  const follows = await db.follow.findMany({ where: { userId: ctx.user.id }, include: { trader: true } });
  const kb = new InlineKeyboard().text("➕ Follow a wallet", "ct:add").row();
  follows.forEach((f) => kb.text(`${f.active ? "🟢" : "⚪️"} ${f.trader.label}${f.paper ? " (paper)" : ""}`, `ct:open:${f.id}`).row());
  const curated = await db.trader.findMany({ where: { active: true }, take: 5 });
  curated.forEach((t) => kb.text(`⭐ ${t.label}`, `ct:follow:${t.id}`).row());
  return ctx.reply("📈 <b>Copytrade</b>\nPick a trader to follow. New follows start in <b>paper mode</b> (no real money).",
    { parse_mode: "HTML", reply_markup: kb });
});

bot.callbackQuery("ct:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  await db.user.update({ where: { id: ctx.user.id }, data: { pending: { action: "follow_address" } } });
  await ctx.reply("Send the Solana wallet address you want to follow:");
});

// Handle the follow_address text step inside the same message:text handler (add this branch next to the others):
//   if (p.action === "follow_address") { validate address → upsert Trader {address,label:"Custom …"} → create Follow → show settings }

bot.callbackQuery(/^ct:follow:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const traderId = ctx.match[1];
  const f = await db.follow.upsert({
    where: { userId_traderId: { userId: ctx.user.id, traderId } },
    update: {}, create: { userId: ctx.user.id, traderId },
  });
  await showFollow(ctx, f.id);
});

async function showFollow(ctx: any, followId: string) {
  const f = await db.follow.findUniqueOrThrow({ where: { id: followId }, include: { trader: true } });
  const kb = new InlineKeyboard()
    .text(f.active ? "⏸ Pause" : "▶️ Start", `ct:toggle:${f.id}`).row()
    .text(f.paper ? "📝 Paper: ON → go live" : "💵 LIVE → back to paper", `ct:mode:${f.id}`).row()
    .text("0.02", `ct:amt:${f.id}:20000000`).text("0.05", `ct:amt:${f.id}:50000000`)
    .text("0.1", `ct:amt:${f.id}:100000000`).row()
    .text("🗑 Unfollow", `ct:del:${f.id}`);
  await ctx.reply(
    `<b>${f.trader.label}</b>\n<code>${f.trader.address}</code>\n\n` +
    `Mode: ${f.paper ? "📝 paper" : "💵 LIVE"}\nBuy size: ${fmtSol(f.buyLamports)} SOL (max ${fmtSol(f.maxLamports)})\n` +
    `Slippage: ${f.slippageBps / 100}%\nStatus: ${f.active ? "🟢 on" : "⚪️ off"}`,
    { parse_mode: "HTML", reply_markup: kb });
}
// Implement handlers for ct:open, ct:toggle, ct:mode, ct:amt, ct:del: each loads the follow, checks ownership
// (follow.userId === ctx.user.id: ALWAYS), updates it, then calls showFollow again.
```
Rules for callbacks: Telegram limits callback data to 64 bytes, so use short IDs; **always verify the follow belongs to the user pressing the button**; and require an extra confirmation (and the PIN, if you like) before switching from paper to **live**.

When a follow is activated or paused, mark the Helius address list as stale so the worker re-syncs it (for example a `Setting` row `helius_dirty=1`).

### 9.5 Telegram webhook route (`app/api/telegram/route.ts`)

```ts
import { webhookCallback } from "grammy";
import { bot } from "@/bot";

export const runtime = "nodejs";
export const POST = webhookCallback(bot, "std/http", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});
```
The `"std/http"` adapter works with Next.js App Router route handlers because they use the standard `Request`/`Response` types (verify against the current grammY docs). Register the webhook once:

```ts
// scripts/set-webhook.ts
import { bot } from "../apps/web/src/bot";
import { COMMANDS } from "../apps/web/src/bot/commands";
await bot.api.setWebhook(`${process.env.PUBLIC_BASE_URL}/api/telegram`, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query"],
});
await bot.api.setMyCommands(COMMANDS);       // gives you the menu shown in your screenshot
console.log("webhook + commands set");
```
Telegram sends your secret back in the `X-Telegram-Bot-Api-Secret-Token` header, and grammY checks it. Anyone who finds your URL still cannot forge updates without that secret.

---

## 10. Next.js routes

### 10.1 Helius webhook receiver (`app/api/helius/route.ts`)

Keep this endpoint **fast and idempotent**: authenticate, parse, store, create pending orders, return 200. All trading happens in the worker.

```ts
import { timingSafeEqual } from "node:crypto";
import { db, parseSwap } from "@copytrade/core";

export const runtime = "nodejs";
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  // Helius sends the authHeader value you configured (verify header name on a real delivery).
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEq(auth, process.env.HELIUS_WEBHOOK_SECRET!)) return new Response("unauthorized", { status: 401 });

  const txs = (await req.json()) as any[];
  for (const tx of txs) {
    const swap = parseSwap(tx);
    if (!swap) continue;

    const trader = await db.trader.findUnique({ where: { address: swap.trader } });
    if (!trader?.active) continue;

    // Idempotent: signature is unique, so a re-delivered webhook is ignored.
    const leader = await db.leaderSwap.upsert({
      where: { signature: swap.signature },
      update: {},
      create: { ...swap, traderId: trader.id },
    });

    const follows = await db.follow.findMany({ where: { traderId: trader.id, active: true } });
    if (follows.length === 0) continue;

    await db.copyOrder.createMany({
      skipDuplicates: true,                                   // unique(followId, leaderSignature)
      data: follows.map((f) => ({
        followId: f.id, swapId: leader.id, leaderSignature: swap.signature,
        side: swap.side, tokenMint: swap.tokenMint, paper: f.paper,
      })),
    });
  }
  return Response.json({ ok: true });
}
```
Skip leader swaps that are too old. If your server was down and Helius replays old events, copying a minutes-old trade is usually a bad idea. Add a `blockTime` freshness check (for example, ignore anything older than 30 to 60 seconds) in the worker.

### 10.2 Admin dashboard (`app/admin/page.tsx`)

```tsx
import { db } from "@copytrade/core";
export const dynamic = "force-dynamic";

export default async function Admin() {
  const [users, follows, pending, failed24h] = await Promise.all([
    db.user.count(),
    db.follow.count({ where: { active: true } }),
    db.copyOrder.count({ where: { status: "PENDING" } }),
    db.copyOrder.count({ where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 864e5) } } }),
  ]);
  return (
    <main className="p-8 space-y-2">
      <h1 className="text-2xl font-bold">Admin</h1>
      <p>Users: {users}</p><p>Active follows: {follows}</p>
      <p>Pending orders: {pending}</p><p>Failed (24h): {failed24h}</p>
    </main>
  );
}
```
Build out later: trader management (add, edit, deactivate), user search, order log with errors, a **global kill switch**, and manual freeze for a user.

`middleware.ts` (basic protection for `/admin`; replace with real auth like NextAuth for production):

```ts
import { NextRequest, NextResponse } from "next/server";
export const config = { matcher: ["/admin/:path*"] };

export function middleware(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    const [u, p] = atob(h.slice(6)).split(":");
    if (u === process.env.ADMIN_USER && p === process.env.ADMIN_PASSWORD) return NextResponse.next();
  }
  return new NextResponse("Auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="admin"' } });
}
```

### 10.3 Landing page
`app/page.tsx`: a simple page explaining the product, a "Open in Telegram" button (`https://t.me/<your_bot>`), the risk disclaimer, terms, and privacy policy. You will need these for trust and for compliance.

### 10.4 Optional: Telegram Mini App (richer UI than chat buttons)

A Mini App is a web page (your Next.js `/mini` route) opened inside Telegram. It is ideal for follow settings, trade history and PIN entry. Always **validate `initData` on the server**; never trust the user id the page sends:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function validateInitData(initData: string, botToken: string, maxAgeSec = 3600) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash"); params.delete("hash");
  if (!hash) return null;
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest("hex");
  if (calc.length !== hash.length || !timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date")) > maxAgeSec) return null;
  return JSON.parse(params.get("user") ?? "null");        // { id, username, ... }
}
```
Load `https://telegram.org/js/telegram-web-app.js` on the page and send `window.Telegram.WebApp.initData` with every API call.

---

## 11. The worker (`apps/worker`)

### 11.1 Main loop (`src/index.ts`)

```ts
import { db } from "@copytrade/core";
import { processCopyOrder } from "./copy-orders";
import { processWithdrawal } from "./withdrawals";
import { checkDeposits } from "./deposits";
import { syncHeliusAddresses } from "./helius-sync";

async function claim(table: "CopyOrder" | "Withdrawal", limit: number): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE "${table}" SET status = 'PROCESSING'
    WHERE id IN (
      SELECT id FROM "${table}" WHERE status = 'PENDING'
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  return rows.map((r) => r.id);
}

async function tick() {
  for (const id of await claim("CopyOrder", 10)) processCopyOrder(id).catch((e) => console.error("order", id, e));
  for (const id of await claim("Withdrawal", 5)) processWithdrawal(id).catch((e) => console.error("wd", id, e));
}

setInterval(() => tick().catch(console.error), 500);
setInterval(() => checkDeposits().catch(console.error), 20_000);
setInterval(() => syncHeliusAddresses().catch(console.error), 30_000);
console.log("worker started");
```
(The table name is interpolated from a fixed union type, not user input, so this raw query is safe.)

**Rule for crash recovery:** an order stuck in `PROCESSING` or `SUBMITTED` must **never** be blindly retried, or you can buy twice. Recover by checking the chain: if there is a stored `txSignature`, look it up (`getSignatureStatuses`) and finish the record; if there is none and it is older than a few minutes, mark it `FAILED` and let a human decide.

### 11.2 Copy orders (`src/copy-orders.ts`)

```ts
import { PublicKey } from "@solana/web3.js";
import {
  db, conn, WSOL, RESERVE_LAMPORTS, fmtSol, getSolBalance, getTokenBalanceRaw, loadKeypair,
  getOrder, executeOrder, signOrderTx, planCopy, assertTokenSafe, SkipError, notify,
} from "@copytrade/core";

const MAX_LEADER_AGE_MS = 45_000;

const finish = (id: string, data: object) => db.copyOrder.update({ where: { id }, data });

export async function processCopyOrder(orderId: string) {
  const order = await db.copyOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { swap: true, follow: { include: { trader: true, user: { include: { wallet: true } } } } },
  });
  const { swap, follow } = order;
  const user = follow.user;
  const tg = user.telegramId;

  try {
    if (process.env.TRADING_ENABLED !== "true") throw new SkipError("trading is globally disabled");
    if (user.status !== "ACTIVE" || !follow.active) throw new SkipError("follow paused");
    if (Date.now() - swap.blockTime.getTime() > MAX_LEADER_AGE_MS) throw new SkipError("leader trade too old");
    if (!order.paper && process.env.LIVE_TRADING_ALLOWED !== "true") throw new SkipError("live trading not enabled");

    const owner = user.wallet!.address;
    const sol = await getSolBalance(owner);
    const held = order.paper ? 0n : await getTokenBalanceRaw(owner, swap.tokenMint);
    const paperPos = order.paper
      ? await db.paperPosition.findUnique({ where: { followId_tokenMint: { followId: follow.id, tokenMint: swap.tokenMint } } })
      : null;

    const plan = planCopy(swap.side, follow, {
      solBalance: order.paper ? 10n ** 12n : sol,       // paper mode has unlimited virtual SOL
      reserve: order.paper ? 0n : RESERVE_LAMPORTS,
      haveTokens: order.paper ? !!paperPos : held > 0n,
    });
    if (plan.kind === "skip") throw new SkipError(plan.reason);
    if (plan.kind === "buy" && follow.strictSafety) await assertTokenSafe(swap.tokenMint);

    const inputMint = plan.kind === "buy" ? WSOL : swap.tokenMint;
    const outputMint = plan.kind === "buy" ? swap.tokenMint : WSOL;
    const amount = plan.kind === "buy" ? plan.lamports : (order.paper ? BigInt(paperPos!.amountRaw) : held);

    /* ---------- PAPER ---------- */
    if (order.paper) {
      const q = await getOrder({ inputMint, outputMint, amount, slippageBps: follow.slippageBps }); // no taker → quote only
      const out = BigInt(String(q.outAmount ?? "0"));
      if (plan.kind === "buy") {
        await db.paperPosition.upsert({
          where: { followId_tokenMint: { followId: follow.id, tokenMint: swap.tokenMint } },
          create: { followId: follow.id, tokenMint: swap.tokenMint, amountRaw: out.toString(), costLamports: amount },
          update: {}, // v1: ignore repeated buys of the same token (or accumulate)
        });
      } else if (paperPos) {
        await db.paperPosition.delete({ where: { id: paperPos.id } });
      }
      await finish(order.id, { status: "CONFIRMED", inAmountRaw: amount.toString(), outAmountRaw: out.toString() });
      const pnl = plan.kind === "sell" && paperPos ? ` (P/L ${fmtSol(out - paperPos.costLamports)} SOL)` : "";
      await notify(tg, `📝 <b>Paper ${swap.side}</b> ${swap.tokenMint.slice(0, 6)}…${pnl}`);
      return;
    }

    /* ---------- LIVE ---------- */
    const kp = loadKeypair(user.wallet!.encrypted as any);
    try {
      const jup = await getOrder({ inputMint, outputMint, amount, taker: owner, slippageBps: follow.slippageBps });
      if (!jup.transaction) throw new Error(`Jupiter returned no transaction: ${JSON.stringify(jup).slice(0, 300)}`);

      // Record the intent BEFORE sending so a crash cannot cause a blind retry.
      await finish(order.id, { status: "SUBMITTED", requestId: jup.requestId, inAmountRaw: amount.toString() });
      const signed = signOrderTx(jup, kp);
      const res = await executeOrder(signed, jup.requestId);

      // Field names for status/signature must be checked against a real /execute response (verify).
      const ok = String(res.status).toLowerCase() === "success";
      await finish(order.id, {
        status: ok ? "CONFIRMED" : "FAILED",
        txSignature: res.signature ?? null,
        outAmountRaw: res.outputAmountResult ? String(res.outputAmountResult) : null,
        error: ok ? null : JSON.stringify(res).slice(0, 500),
      });
      await notify(tg, ok
        ? `✅ <b>${swap.side}</b> copied from ${follow.trader.label}\nhttps://solscan.io/tx/${res.signature}`
        : `❌ ${swap.side} failed. Nothing was spent unless the transaction landed.`);
    } finally {
      kp.secretKey.fill(0);
    }
  } catch (e: any) {
    if (e instanceof SkipError) {
      await finish(order.id, { status: "SKIPPED", skipReason: e.message });
      return;                                                // do not spam users with every skip
    }
    await finish(order.id, { status: "FAILED", error: String(e?.message ?? e).slice(0, 500) });
    await notify(tg, `❌ Copy trade failed: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}
```
The Jupiter `/execute` response fields and the exact "status" values are not confirmed here, so print a real response during devnet-sized tests and adapt this block. The principle stands regardless: **write `SUBMITTED` before sending, and never auto-retry after sending.**

### 11.3 Withdrawals (`src/withdrawals.ts`)

```ts
import { Transaction, SystemProgram, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { db, conn, loadKeypair, fmtSol, notify } from "@copytrade/core";

export async function processWithdrawal(id: string) {
  const w = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { user: { include: { wallet: true } } } });
  const kp = loadKeypair(w.user.wallet!.encrypted as any);
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(w.toAddress), lamports: w.lamports }),
    );
    tx.sign(kp);
    const sig = bs58.encode(tx.signature!);

    await db.withdrawal.update({ where: { id }, data: { status: "SUBMITTED", txSignature: sig } }); // before sending
    await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    await db.withdrawal.update({ where: { id }, data: { status: "CONFIRMED" } });
    await notify(w.user.telegramId, `✅ Sent ${fmtSol(w.lamports)} SOL\nhttps://solscan.io/tx/${sig}`);
  } catch (e: any) {
    await db.withdrawal.update({ where: { id }, data: { status: "FAILED", error: String(e.message).slice(0, 300) } });
    await notify(w.user.telegramId, "❌ Withdrawal failed. Your funds were not moved unless it appears on Solscan.");
  } finally {
    kp.secretKey.fill(0);
  }
}
```

### 11.4 Deposits (`src/deposits.ts`)

Because the wallet is the deposit address, you only need to notice balance increases:

```ts
import { db, getSolBalance, fmtSol, notify } from "@copytrade/core";

export async function checkDeposits() {
  const wallets = await db.wallet.findMany({ include: { user: true } });   // fine for hundreds; page or filter for more
  for (const w of wallets) {
    const now = await getSolBalance(w.address);
    if (now > w.lastKnownLamports + 1_000_000n) {                          // > 0.001 SOL increase
      await notify(w.user.telegramId, `📥 Received ${fmtSol(now - w.lastKnownLamports)} SOL. Balance: ${fmtSol(now)} SOL`);
    }
    if (now !== w.lastKnownLamports) {
      await db.wallet.update({ where: { id: w.id }, data: { lastKnownLamports: now } });
    }
  }
}
```
A balance drop caused by your own trades or withdrawals also updates `lastKnownLamports`, which is fine. For thousands of users, replace polling with a Helius webhook on the user wallet addresses (check the plan's address limits (verify)) and only poll active users.

### 11.5 Helius address sync (`src/helius-sync.ts`)

```ts
import { db, setWebhookAddresses } from "@copytrade/core";

let last = "";
export async function syncHeliusAddresses() {
  const traders = await db.trader.findMany({ where: { active: true, follows: { some: { active: true } } }, select: { address: true } });
  const addrs = traders.map((t) => t.address).sort();
  const key = addrs.join(",");
  if (key === last || !process.env.HELIUS_WEBHOOK_ID) return;
  await setWebhookAddresses(process.env.HELIUS_WEBHOOK_ID, addrs);
  last = key;
}
```

### 11.6 Run the worker
```json
// apps/worker/package.json
{ "scripts": { "dev": "tsx watch --env-file=../../.env src/index.ts", "start": "tsx src/index.ts" } }
```
For production, build a Docker image and run it as a single always-on instance. Do not run multiple worker replicas until you have tested the claiming logic under load. Even with `SKIP LOCKED`, a stuck `PROCESSING` row needs the recovery rule above.

---

## 12. Local development and testing

**Paper mode first.** Everything above works with `paper = true` and no private key is ever used.

1. `pnpm dev` in `apps/web`. Expose it with a tunnel (`cloudflared tunnel --url http://localhost:3000` or ngrok) and set `PUBLIC_BASE_URL` to the tunnel URL. Run `tsx scripts/set-webhook.ts`.
2. Run the worker: `pnpm --filter worker dev` with `TRADING_ENABLED=true`, `LIVE_TRADING_ALLOWED=false`.
3. In Telegram: `/start`, `/wallet`, `/balance`, `/deposit` (no real deposit yet).
4. Add a trader (insert a `Trader` row with a known active wallet, or use `/copytrade → Follow a wallet`), activate, and wait for that wallet to swap. Watch the order go `PENDING → CONFIRMED` with a paper notification.
5. Create the Helius webhook once with `scripts/create-helius-webhook.ts`, save its ID as `HELIUS_WEBHOOK_ID`. Webhook updates may take about two minutes to apply.
6. **Unit tests** for `planCopy`, `parseSwap` (use saved real webhook payloads as fixtures), `encryptSecret`/`decryptSecret` round-trip, and `validateInitData`.
7. **Replay test:** send the same Helius payload twice and confirm only one `LeaderSwap` and one `CopyOrder` exist.
8. **Live test, tiny and personal:** only your own account, a small amount (for example 0.05 SOL), `LIVE_TRADING_ALLOWED=true`, one follow, tight per-trade cap. Compare the bot's records to Solscan. Jupiter runs on mainnet, so there is no devnet equivalent. This is why paper mode and tiny caps matter.

---

## 13. Security: mandatory before any real user funds

**Keys**
- Private keys exist only encrypted at rest. In production the master key lives in a KMS/HSM; the code never sees it.
- Only the worker can decrypt. The public web app has **no** decrypt permission and no KEK in its environment.
- Never log secrets. Configure `pino` redaction and Sentry scrubbing. Never put keys in error messages.
- Do not offer "export private key" in v1. If you must, require the PIN plus a cooldown and delete the message after a few seconds.

**Account takeover (the most common loss)**
- Telegram account hijacking (SIM swap, stolen session) gives an attacker the bot. The withdrawal PIN, daily limits, new-address cooldown and withdrawal notifications are your protection. Do not skip them.
- Lock out after repeated wrong PINs.
- Let users freeze their account, and make support able to freeze it too.

**Infrastructure**
- Verify every inbound webhook (Telegram secret token, Helius `authHeader`) with constant-time comparison.
- Rate-limit bot commands per user.
- Validate every input (addresses, numbers) and every callback ownership (user owns the follow).
- Least-privilege database roles (the web app role cannot read the `Wallet.encrypted` column if you can arrange it).
- Dependency pinning, lockfile, secret scanning in CI, 2FA on every infra account (GitHub, Vercel, cloud, Helius, Jupiter, BotFather).
- Automated backups for Postgres, and test restoring one.

**Trading risk controls**
- Global kill switch (`TRADING_ENABLED`), per-user and per-follow caps, daily loss limit, minimum SOL reserve, maximum slippage.
- Token checks, and ignore dust and tokens with no liquidity.
- Hard cap the total value any single user can have trading during your pilot.

**Process**
- An incident runbook (how to flip the kill switch, rotate keys, notify users).
- Start with a closed beta of people you know, small caps, then an **independent security review** before opening up. For a custodial product that holds other people's money, a review is not optional.

**Telegram impersonation:** fake copies of your bot will appear. Put your exact bot username on your website and social accounts, and warn users that the bot will never DM first or ask for keys.

---

## 14. Deployment

| Piece | Where | Notes |
|---|---|---|
| Postgres | Neon, Supabase or Railway | Daily backups, connection pooling for serverless |
| Web (Next.js) | Vercel or Railway | Set all env vars **except** `WALLET_KEK_BASE64` |
| Worker | Railway, Fly.io, or a VPS (Docker) | One always-on instance; gets KMS/KEK access |
| Webhooks | `PUBLIC_BASE_URL/api/telegram`, `/api/helius` | Must be public HTTPS |

Steps: deploy web → run Prisma migrations (`prisma migrate deploy`) → set Telegram webhook → create Helius webhook → deploy worker → confirm in logs that a paper order flows end to end.

Add Sentry to both apps, structured logs, and an alert (Telegram message to your own admin chat) for: worker crash, orders stuck in `PROCESSING`/`SUBMITTED` over 2 minutes, failure rate spike, RPC errors, low Helius/Jupiter quota.

---

## 15. Operating costs to expect

Helius plan (webhooks and RPC volume), Jupiter API tier, Postgres, worker hosting, error tracking, a KMS, and legal fees. Check each provider's current pricing and limits, because they change **(verify)**. If you add a fee on swaps, Jupiter's API supports integrator referral fees on the `/order` path (see their docs for referral account setup), but whether and how you may charge fees is a legal question (section 17).

---

## 16. Roadmap

| Phase | Goal | Done when |
|---|---|---|
| **0** | Repo, DB, bot answers `/start` `/help` `/wallet` | Wallet created and encrypted; DB shows no plaintext keys |
| **1** | `/balance`, `/deposit` with arrival notifications | A small test deposit triggers a message |
| **2** | Helius webhook → `LeaderSwap` → paper `CopyOrder`s | A real leader swap produces a paper trade message, idempotent on replay |
| **3** | `/copytrade` UI: follow, settings, pause, paper P/L | Full follow flow works from buttons only |
| **4** | Withdrawals with PIN, limits, cooldown | You can withdraw your own test funds safely |
| **5** | Live trading for you only, tiny caps | Bot-reported trades match Solscan |
| **6** | Admin dashboard, kill switch, alerts, runbook | You can stop everything in one click |
| **7** | Closed beta (friends, small caps) + security review + legal review | Findings fixed |
| **8** | Public launch, Mini App, trader stats, proportional sells, more safety checks | |
| **Later** | Second chain (the USDT/EVM address in your screenshot), referral program, subscription/fee model | |

---

## 17. Legal and compliance (not legal advice)

Holding users' funds and executing trades on their behalf is regulated in many countries. Depending on where you and your users are, this can touch money-transmission or virtual-asset service-provider rules, securities or investment-advice rules (copy trading can look like portfolio management), consumer-protection law, and AML/KYC obligations. Fee-taking makes it more likely, not less. Before accepting real money:

- Get advice from a lawyer experienced in crypto in your jurisdiction, and in the jurisdictions of your users.
- Publish clear Terms of Service, a Privacy Policy and a risk disclaimer ("not financial advice, you can lose everything, past performance is not indicative").
- Be truthful in marketing: never promise profits or guaranteed returns.
- Consider geo-restrictions and what records you must keep (transactions, tax).
- Consider the non-custodial alternative below, which reduces (but does not remove) your regulatory exposure.

### Non-custodial alternative (safer)
Instead of holding keys, users keep their own wallet and the bot only requests permission to trade a limited amount: a Telegram Mini App with a wallet connection where users approve each copy trade (slow, semi-manual), or a delegated-authority / session-key approach on a smart-wallet platform with strict spend limits (more complex). You give up the "fully automatic, instant" feel, but you stop being the custodian of everyone's money.

---

## 18. Common pitfalls

- **Double execution:** retries after a send. Always record `SUBMITTED` first; reconcile by signature.
- **Duplicate webhooks:** rely on unique constraints, never on "it will probably arrive once."
- **Stale leader trades:** after downtime, skip trades older than your freshness window.
- **Fee payer is not always the trader:** verify who really owns the swapped balances.
- **Token decimals and raw units:** keep everything as raw integers (`BigInt`) until display.
- **New token accounts cost rent** (~0.002 SOL each): keep a SOL reserve.
- **BigInt and JSON:** Prisma returns `BigInt`; convert to string before sending as JSON.
- **Serverless limits:** do no trading in Next.js routes. Webhook handlers return quickly.
- **Callback data length (64 bytes)** and **Telegram send rate limits** (throttle fan-out).
- **Bait wallets and honeypots:** a leader with great-looking history may exist only to attract copiers.
- **Slippage:** copiers always pay more than the leader. Tight caps, and tell users.
- **Jupiter tokens with Token-2022 extensions:** extra checks needed.
- **Provider API drift:** Jupiter has already moved from v1 to v2. Pin versions and re-check docs when something breaks.

---

## 19. References

- Telegram Bot API and Mini Apps: core.telegram.org/bots, core.telegram.org/bots/webapps
- grammY (webhooks, adapters): grammy.dev
- Next.js App Router route handlers: nextjs.org/docs
- Prisma: prisma.io/docs
- Solana web3.js and SPL token: solana.com/docs, github.com/solana-labs/solana-web3.js
- Jupiter Swap API v2 (order/execute): developers.jup.ag/docs/swap
- Helius webhooks and enhanced transactions: helius.dev/docs
- Envelope encryption and KMS: docs of your cloud provider (AWS KMS, GCP KMS)
