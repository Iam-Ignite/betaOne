import type { PlanType } from "../types";

export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUBMITTED"
  | "CONFIRMED"
  | "SKIPPED"
  | "FAILED";

export type Side = "BUY" | "SELL";

export type UserStatus = "ACTIVE" | "FROZEN";

export type WithdrawAsset = "SOL" | "USDT" | "BNB";

export type WithdrawalStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED";

export interface AuditLog {
  _id?: string;
  id: string;
  userId: string | null;
  action: string;
  meta: any;
  createdAt: Date;
}

export interface CopyOrder {
  _id?: string;
  id: string;
  followId: string;
  swapId: string;
  leaderSignature: string;
  side: Side;
  tokenMint: string;
  paper: boolean;
  status: OrderStatus;
  inAmountRaw: string | null;
  outAmountRaw: string | null;
  requestId: string | null;
  txSignature: string | null;
  skipReason: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  follow: Follow;
  swap: LeaderSwap;
  Follow: Follow;
  LeaderSwap: LeaderSwap;
}

export interface Follow {
  _id?: string;
  id: string;
  userId: string;
  traderId: string;
  active: boolean;
  paper: boolean;
  buyLamports: bigint;
  maxLamports: bigint;
  slippageBps: number;
  copyBuys: boolean;
  copySells: boolean;
  strictSafety: boolean;
  createdAt: Date;
  startedAt: Date | null;
  statusMessageId: bigint | null;
  user: User;
  trader: Trader;
  User: User;
  Trader: Trader;
  copyOrders: CopyOrder[];
  livePositions: LivePosition[];
  paperPositions: PaperPosition[];
}

export interface LeaderSwap {
  _id?: string;
  id: string;
  signature: string;
  traderId: string;
  side: Side;
  tokenMint: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  blockTime: Date;
  createdAt: Date;
  trader: Trader;
  Trader: Trader;
  copyOrders: CopyOrder[];
}

export interface LedgerEntry {
  _id?: string;
  id: string;
  userId: string;
  asset: WithdrawAsset;
  deltaRaw: bigint;
  balanceAfter: bigint;
  reason: string;
  refId: string | null;
  createdAt: Date;
  user: User;
  User: User;
}

export interface LivePosition {
  _id?: string;
  id: string;
  followId: string;
  tokenMint: string;
  amountRaw: string;
  costLamports: bigint;
  createdAt: Date;
  updatedAt: Date;
  follow: Follow;
  Follow: Follow;
}

export interface PaperPosition {
  _id?: string;
  id: string;
  followId: string;
  tokenMint: string;
  amountRaw: string;
  costLamports: bigint;
  follow: Follow;
  Follow: Follow;
}

export interface SubscriptionPlan {
  _id?: string;
  id: string;
  name: string;
  planType: PlanType;
  price: bigint;
  features: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface Setting {
  _id?: string;
  id: string;
  key: string;
  value: string;
}

export interface Trader {
  _id?: string;
  id: string;
  address: string;
  label: string;
  active: boolean;
  createdAt: Date;
  follows: Follow[];
  Follow: Follow[];
  leaderSwaps: LeaderSwap[];
  LeaderSwap: LeaderSwap[];
}

export interface User {
  _id?: string;
  id: string;
  telegramId: bigint;
  username: string | null;
  status: UserStatus;
  pinHash: string | null;
  pending?: any;
  referralCode: string | null;
  referredBy: string | null;
  referralEarnings: bigint;
  balanceBnb: bigint;
  balanceSol: bigint;
  balanceUsdt: bigint;
  planType: PlanType;
  planEndDate: Date | null;
  createdAt: Date;
  wallet: Wallet | null;
  Wallet: Wallet | null;
  follows: Follow[];
  Follow: Follow[];
  withdrawals: Withdrawal[];
  Withdrawal: Withdrawal[];
  ledgerEntries: LedgerEntry[];
  LedgerEntry: LedgerEntry[];
}

export interface Wallet {
  _id?: string;
  id: string;
  userId: string;
  address: string;
  encrypted: any;
  lastKnownLamports: bigint;
  evmAddress: string | null;
  evmEncrypted: any;
  lastKnownUsdt: bigint;
  lastKnownEvmNative: bigint;
  createdAt: Date;
  user: User;
  User: User;
}

export interface Withdrawal {
  _id?: string;
  id: string;
  userId: string;
  toAddress: string;
  status: WithdrawalStatus;
  txSignature: string | null;
  error: string | null;
  createdAt: Date;
  amountRaw: bigint;
  asset: WithdrawAsset;
  approvedAt: Date | null;
  approvedBy: string | null;
  note: string | null;
  user: User;
  User: User;
}

export namespace Prisma {
  export type InputJsonValue = any;
  export type JsonValue = any;
  export type Decimal = any;
}
export const Prisma = {
  DbNull: null,
  JsonNull: null,
  AnyNull: null,
} as any;
