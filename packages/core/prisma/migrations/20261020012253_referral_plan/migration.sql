-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUBMITTED', 'CONFIRMED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'FROZEN');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "WithdrawAsset" AS ENUM ('SOL', 'USDT', 'BNB');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyOrder" (
    "id" TEXT NOT NULL,
    "followId" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "leaderSignature" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "paper" BOOLEAN NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "inAmountRaw" TEXT,
    "outAmountRaw" TEXT,
    "requestId" TEXT,
    "txSignature" TEXT,
    "skipReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "paper" BOOLEAN NOT NULL DEFAULT false,
    "buyLamports" BIGINT NOT NULL DEFAULT 50000000,
    "maxLamports" BIGINT NOT NULL DEFAULT 100000000,
    "slippageBps" INTEGER NOT NULL DEFAULT 1000,
    "copyBuys" BOOLEAN NOT NULL DEFAULT true,
    "copySells" BOOLEAN NOT NULL DEFAULT true,
    "strictSafety" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "statusMessageId" BIGINT,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderSwap" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "inputMint" TEXT NOT NULL,
    "outputMint" TEXT NOT NULL,
    "inAmount" TEXT NOT NULL,
    "outAmount" TEXT NOT NULL,
    "blockTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" "WithdrawAsset" NOT NULL,
    "deltaRaw" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePosition" (
    "id" TEXT NOT NULL,
    "followId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "costLamports" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL,
    "followId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "costLamports" BIGINT NOT NULL,

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "price" BIGINT NOT NULL,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Trader" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinHash" TEXT,
    "referralCode" TEXT,
    "referredBy" TEXT,
    "referralEarnings" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balanceBnb" BIGINT NOT NULL DEFAULT 0,
    "balanceSol" BIGINT NOT NULL DEFAULT 0,
    "balanceUsdt" BIGINT NOT NULL DEFAULT 0,
    "planType" "PlanType" NOT NULL DEFAULT 'FREE',
    "planEndDate" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encrypted" JSONB NOT NULL,
    "lastKnownLamports" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evmAddress" TEXT,
    "evmEncrypted" JSONB,
    "lastKnownUsdt" BIGINT NOT NULL DEFAULT 0,
    "lastKnownEvmNative" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "txSignature" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountRaw" BIGINT NOT NULL,
    "asset" "WithdrawAsset" NOT NULL DEFAULT 'SOL',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopyOrder_status_createdAt_idx" ON "CopyOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopyOrder_followId_leaderSignature_key" ON "CopyOrder"("followId", "leaderSignature");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_userId_traderId_key" ON "Follow"("userId", "traderId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderSwap_signature_key" ON "LeaderSwap"("signature");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LivePosition_followId_idx" ON "LivePosition"("followId");

-- CreateIndex
CREATE UNIQUE INDEX "LivePosition_followId_tokenMint_key" ON "LivePosition"("followId", "tokenMint");

-- CreateIndex
CREATE UNIQUE INDEX "PaperPosition_followId_tokenMint_key" ON "PaperPosition"("followId", "tokenMint");

-- CreateIndex
CREATE UNIQUE INDEX "Trader_address_key" ON "Trader"("address");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_evmAddress_key" ON "Wallet"("evmAddress");

-- CreateIndex
CREATE INDEX "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_asset_createdAt_idx" ON "Withdrawal"("userId", "asset", "createdAt");

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_followId_fkey" FOREIGN KEY ("followId") REFERENCES "Follow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyOrder" ADD CONSTRAINT "CopyOrder_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "LeaderSwap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderSwap" ADD CONSTRAINT "LeaderSwap_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePosition" ADD CONSTRAINT "LivePosition_followId_fkey" FOREIGN KEY ("followId") REFERENCES "Follow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_followId_fkey" FOREIGN KEY ("followId") REFERENCES "Follow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
