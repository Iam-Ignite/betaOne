import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };

export const db = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") g.prisma = db;

// Re-exported so consumer apps resolve Prisma through a single generated client.
export { Prisma } from "@prisma/client";
export type {
  User,
  Wallet,
  Trader,
  Follow,
  LeaderSwap,
  CopyOrder,
  PaperPosition,
  LivePosition,
  Withdrawal,
  LedgerEntry,
  Setting,
  AuditLog,
} from "@prisma/client";
