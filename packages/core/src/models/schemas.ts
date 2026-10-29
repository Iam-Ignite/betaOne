import mongoose, { Schema, type Model } from "mongoose";
import { randomUUID } from "node:crypto";
import type {
  AuditLog,
  CopyOrder,
  Follow,
  LeaderSwap,
  LedgerEntry,
  LivePosition,
  PaperPosition,
  SubscriptionPlan,
  Setting,
  Trader,
  User,
  Wallet,
  Withdrawal,
} from "./types";

const defaultIdGen = () => randomUUID();

function applySyncId(schema: Schema<any>) {
  schema.pre("validate", function (this: any) {
    if (!this.id && this._id) this.id = this._id;
    if (!this._id && this.id) this._id = this.id;
  });
  schema.pre("save", function (this: any) {
    if (!this.id && this._id) this.id = this._id;
    if (!this._id && this.id) this._id = this.id;
  });
}

// 1. AuditLog
const AuditLogSchema = new Schema<AuditLog>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    userId: { type: String, default: null, index: true },
    action: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(AuditLogSchema);

// 2. Setting
const SettingSchema = new Schema<Setting>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen },
    key: { type: String, required: true, unique: true, index: true },
    value: { type: String, required: true },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(SettingSchema);

// 3. User
const UserSchema = new Schema<User>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    telegramId: { type: Schema.Types.Mixed, required: true, unique: true, index: true },
    username: { type: String, default: null },
    status: { type: String, enum: ["ACTIVE", "FROZEN"], default: "ACTIVE" },
    pinHash: { type: String, default: null },
    pending: { type: Schema.Types.Mixed, default: null },
    referralCode: { type: String, default: null, sparse: true, unique: true },
    referredBy: { type: String, default: null },
    referralEarnings: { type: Schema.Types.Mixed, default: 0n },
    balanceBnb: { type: Schema.Types.Mixed, default: 0n },
    balanceSol: { type: Schema.Types.Mixed, default: 0n },
    balanceUsdt: { type: Schema.Types.Mixed, default: 0n },
    planType: {
      type: String,
      enum: ["OMEGA", "GAMMA", "BETA", "ALPHA"],
      default: "OMEGA",
    },
    planEndDate: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(UserSchema);

// 4. Wallet
const WalletSchema = new Schema<Wallet>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    userId: { type: String, required: true, unique: true, index: true },
    address: { type: String, required: true, unique: true, index: true },
    encrypted: { type: Schema.Types.Mixed, required: true },
    lastKnownLamports: { type: Schema.Types.Mixed, default: 0n },
    evmAddress: { type: String, default: null, sparse: true, unique: true },
    evmEncrypted: { type: Schema.Types.Mixed, default: null },
    lastKnownUsdt: { type: Schema.Types.Mixed, default: 0n },
    lastKnownEvmNative: { type: Schema.Types.Mixed, default: 0n },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(WalletSchema);

// 5. Trader
const TraderSchema = new Schema<Trader>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    address: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(TraderSchema);

// 6. Follow
const FollowSchema = new Schema<Follow>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    userId: { type: String, required: true, index: true },
    traderId: { type: String, required: true, index: true },
    active: { type: Boolean, default: false, index: true },
    paper: { type: Boolean, default: false },
    buyLamports: { type: Schema.Types.Mixed, default: 50000000n },
    maxLamports: { type: Schema.Types.Mixed, default: 100000000n },
    slippageBps: { type: Number, default: 1000 },
    copyBuys: { type: Boolean, default: true },
    copySells: { type: Boolean, default: true },
    strictSafety: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: null },
    statusMessageId: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false, timestamps: false }
);
FollowSchema.index({ userId: 1, traderId: 1 }, { unique: true });
applySyncId(FollowSchema);

// 7. LeaderSwap
const LeaderSwapSchema = new Schema<LeaderSwap>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    signature: { type: String, required: true, unique: true, index: true },
    traderId: { type: String, required: true, index: true },
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    tokenMint: { type: String, required: true },
    inputMint: { type: String, required: true },
    outputMint: { type: String, required: true },
    inAmount: { type: String, required: true },
    outAmount: { type: String, required: true },
    blockTime: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(LeaderSwapSchema);

// 8. CopyOrder
const CopyOrderSchema = new Schema<CopyOrder>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    followId: { type: String, required: true, index: true },
    swapId: { type: String, required: true, index: true },
    leaderSignature: { type: String, required: true },
    side: { type: String, enum: ["BUY", "SELL"], required: true },
    tokenMint: { type: String, required: true },
    paper: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SUBMITTED", "CONFIRMED", "SKIPPED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    inAmountRaw: { type: String, default: null },
    outAmountRaw: { type: String, default: null },
    requestId: { type: String, default: null },
    txSignature: { type: String, default: null },
    skipReason: { type: String, default: null },
    error: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
CopyOrderSchema.index({ followId: 1, leaderSignature: 1 }, { unique: true });
CopyOrderSchema.index({ status: 1, createdAt: 1 });
applySyncId(CopyOrderSchema);

// 9. PaperPosition
const PaperPositionSchema = new Schema<PaperPosition>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    followId: { type: String, required: true, index: true },
    tokenMint: { type: String, required: true },
    amountRaw: { type: String, required: true },
    costLamports: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false, timestamps: false }
);
PaperPositionSchema.index({ followId: 1, tokenMint: 1 }, { unique: true });
applySyncId(PaperPositionSchema);

// 10. LivePosition
const LivePositionSchema = new Schema<LivePosition>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    followId: { type: String, required: true, index: true },
    tokenMint: { type: String, required: true },
    amountRaw: { type: String, required: true },
    costLamports: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
LivePositionSchema.index({ followId: 1, tokenMint: 1 }, { unique: true });
applySyncId(LivePositionSchema);

// 11. Withdrawal
const WithdrawalSchema = new Schema<Withdrawal>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    userId: { type: String, required: true, index: true },
    toAddress: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SUBMITTED", "CONFIRMED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    txSignature: { type: String, default: null },
    error: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    amountRaw: { type: Schema.Types.Mixed, required: true },
    asset: { type: String, enum: ["SOL", "USDT", "BNB"], default: "SOL" },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    note: { type: String, default: null },
  },
  { versionKey: false, timestamps: false }
);
WithdrawalSchema.index({ status: 1, createdAt: 1 });
WithdrawalSchema.index({ userId: 1, asset: 1, createdAt: 1 });
applySyncId(WithdrawalSchema);

// 12. LedgerEntry
const LedgerEntrySchema = new Schema<LedgerEntry>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    userId: { type: String, required: true, index: true },
    asset: { type: String, enum: ["SOL", "USDT", "BNB"], required: true },
    deltaRaw: { type: Schema.Types.Mixed, required: true },
    balanceAfter: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, required: true },
    refId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false, timestamps: false }
);
LedgerEntrySchema.index({ userId: 1, createdAt: 1 });
applySyncId(LedgerEntrySchema);

// 13. Plan
const PlanSchema = new Schema<SubscriptionPlan>(
  {
    _id: { type: String, default: defaultIdGen },
    id: { type: String, default: defaultIdGen, index: true },
    name: { type: String, required: true },
    planType: {
      type: String,
      enum: ["OMEGA", "GAMMA", "BETA", "ALPHA"],
      required: true,
    },
    price: { type: Schema.Types.Mixed, required: true },
    features: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);
applySyncId(PlanSchema);

export const AuditLogModel: Model<AuditLog> =
  mongoose.models.AuditLog || mongoose.model<AuditLog>("AuditLog", AuditLogSchema);

export const SettingModel: Model<Setting> =
  mongoose.models.Setting || mongoose.model<Setting>("Setting", SettingSchema);

export const UserModel: Model<User> =
  mongoose.models.User || mongoose.model<User>("User", UserSchema);

export const WalletModel: Model<Wallet> =
  mongoose.models.Wallet || mongoose.model<Wallet>("Wallet", WalletSchema);

export const TraderModel: Model<Trader> =
  mongoose.models.Trader || mongoose.model<Trader>("Trader", TraderSchema);

export const FollowModel: Model<Follow> =
  mongoose.models.Follow || mongoose.model<Follow>("Follow", FollowSchema);

export const LeaderSwapModel: Model<LeaderSwap> =
  mongoose.models.LeaderSwap ||
  mongoose.model<LeaderSwap>("LeaderSwap", LeaderSwapSchema);

export const CopyOrderModel: Model<CopyOrder> =
  mongoose.models.CopyOrder ||
  mongoose.model<CopyOrder>("CopyOrder", CopyOrderSchema);

export const PaperPositionModel: Model<PaperPosition> =
  mongoose.models.PaperPosition ||
  mongoose.model<PaperPosition>("PaperPosition", PaperPositionSchema);

export const LivePositionModel: Model<LivePosition> =
  mongoose.models.LivePosition ||
  mongoose.model<LivePosition>("LivePosition", LivePositionSchema);

export const WithdrawalModel: Model<Withdrawal> =
  mongoose.models.Withdrawal ||
  mongoose.model<Withdrawal>("Withdrawal", WithdrawalSchema);

export const LedgerEntryModel: Model<LedgerEntry> =
  mongoose.models.LedgerEntry ||
  mongoose.model<LedgerEntry>("LedgerEntry", LedgerEntrySchema);

export const PlanModel: Model<SubscriptionPlan> =
  mongoose.models.Plan || mongoose.model<SubscriptionPlan>("Plan", PlanSchema);
