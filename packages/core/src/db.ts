import mongoose, { type Model } from "mongoose";
import { randomUUID } from "node:crypto";
import { toBigInt } from "./utils";
import {
  AuditLogModel,
  CopyOrderModel,
  FollowModel,
  LeaderSwapModel,
  LedgerEntryModel,
  LivePositionModel,
  PaperPositionModel,
  PlanModel,
  SettingModel,
  TraderModel,
  UserModel,
  WalletModel,
  WithdrawalModel,
} from "./models/schemas";
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
} from "./models/types";

// Re-export models and types
export type {
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
  OrderStatus,
  Side,
  UserStatus,
  WithdrawAsset,
  WithdrawalStatus,
} from "./models/types";
export { Prisma } from "./models/types";

export {
  AuditLogModel,
  CopyOrderModel,
  FollowModel,
  LeaderSwapModel,
  LedgerEntryModel,
  LivePositionModel,
  PaperPositionModel,
  PlanModel,
  SettingModel,
  TraderModel,
  UserModel,
  WalletModel,
  WithdrawalModel,
};

let isConnected = false;
let connectPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (connectPromise) return connectPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  connectPromise = mongoose
    .connect(uri, { dbName: "copytrade" })
    .then((m) => {
      isConnected = true;
      connectPromise = null;
      return m;
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });

  return connectPromise;
}

export async function closeDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    isConnected = false;
  }
}

async function ensureConnected(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    await connectDB();
  }
}

function normalizeDoc(doc: any): any {
  if (!doc) return doc;
  if (Array.isArray(doc)) return doc.map(normalizeDoc);
  if (typeof doc !== "object" || doc instanceof Date) return doc;

  const out: any = { ...doc };
  if (out._id && !out.id) {
    out.id = out._id.toString();
  } else if (out.id && !out._id) {
    out._id = out.id;
  }
  return out;
}

function translateWhere(where: any): any {
  if (!where || typeof where !== "object") return where;
  const result: any = {};

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    // Compound unique keys like followId_tokenMint, userId_traderId, etc.
    if (
      key.includes("_") &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const inner = translateWhere(value);
      Object.assign(result, inner);
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    ) {
      const ops: any = {};
      let hasOp = false;
      for (const [op, opVal] of Object.entries(value)) {
        if (op === "in") {
          ops["$in"] = opVal;
          hasOp = true;
        } else if (op === "notIn") {
          ops["$nin"] = opVal;
          hasOp = true;
        } else if (op === "gte") {
          ops["$gte"] = opVal;
          hasOp = true;
        } else if (op === "lte") {
          ops["$lte"] = opVal;
          hasOp = true;
        } else if (op === "gt") {
          ops["$gt"] = opVal;
          hasOp = true;
        } else if (op === "lt") {
          ops["$lt"] = opVal;
          hasOp = true;
        } else if (op === "not") {
          ops["$ne"] = opVal;
          hasOp = true;
        } else if (op === "equals") {
          ops["$eq"] = opVal;
          hasOp = true;
        }
      }
      if (hasOp) {
        result[key] = ops;
      } else {
        result[key] = translateWhere(value);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

function translateOrderBy(orderBy: any): any {
  if (!orderBy) return undefined;
  if (Array.isArray(orderBy)) {
    const sort: any = {};
    for (const item of orderBy) {
      Object.assign(sort, translateOrderBy(item));
    }
    return sort;
  }
  const sort: any = {};
  for (const [k, v] of Object.entries(orderBy)) {
    sort[k] = v === "desc" || v === -1 ? -1 : 1;
  }
  return sort;
}

function flattenData(data: any): any {
  if (!data || typeof data !== "object") return data;
  const update: any = {};
  const setFields: any = {};
  const incFields: any = {};

  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    ) {
      if ("increment" in value) {
        incFields[key] = toBigInt((value as any).increment);
        continue;
      }
      if ("decrement" in value) {
        incFields[key] = -toBigInt((value as any).decrement);
        continue;
      }
    }
    setFields[key] = value;
  }

  if (Object.keys(setFields).length > 0) update.$set = setFields;
  if (Object.keys(incFields).length > 0) update.$inc = incFields;
  // Ensure BigInt values are passed as BigInt (Mongoose BigInt)
  const out = Object.keys(update).length > 0 ? update : data;
  return out;
}

/**
 * Prisma-style `select` can also request relations as nested objects. The
 * adapter only knows how to populate relations through `include`, so derive an
 * include map from `select` when no explicit include was provided.
 */
function includeFromSelect(select: any): any {
  if (!select || typeof select !== "object") return undefined;
  const rel: any = {};
  for (const [key, value] of Object.entries(select)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      rel[key] = value;
    }
  }
  return Object.keys(rel).length > 0 ? rel : undefined;
}

async function populateIncludes(doc: any, include: any, modelName: string): Promise<any> {
  if (!doc || !include) return normalizeDoc(doc);
  const out = normalizeDoc(doc);

  if (modelName === "User") {
    if (include.wallet || include.Wallet) {
      const w = await WalletModel.findOne({ userId: out.id }).lean();
      out.wallet = normalizeDoc(w);
      out.Wallet = out.wallet;
    }
    if (include.follows || include.Follow) {
      const followQuery = FollowModel.find({ userId: out.id });
      const follows = await followQuery.lean();
      const populated = await Promise.all(
        follows.map(async (f: any) => {
          const nf = normalizeDoc(f);
          if (include.follows?.include?.trader || include.follows?.select?.trader) {
            const t = await TraderModel.findOne({ id: nf.traderId }).lean();
            nf.trader = normalizeDoc(t);
            nf.Trader = nf.trader;
          }
          return nf;
        })
      );
      out.follows = populated;
      out.Follow = populated;
    }
    if (include.withdrawals || include.Withdrawal) {
      const wds = await WithdrawalModel.find({ userId: out.id }).lean();
      out.withdrawals = wds.map(normalizeDoc);
      out.Withdrawal = out.withdrawals;
    }
    if (include.ledgerEntries || include.LedgerEntry) {
      const entries = await LedgerEntryModel.find({ userId: out.id }).lean();
      out.ledgerEntries = entries.map(normalizeDoc);
      out.LedgerEntry = out.ledgerEntries;
    }
  } else if (modelName === "Wallet") {
    if (include.user || include.User) {
      const u = await UserModel.findOne({ id: out.userId }).lean();
      out.user = normalizeDoc(u);
      out.User = out.user;
    }
  } else if (modelName === "Withdrawal") {
    if (include.user || include.User) {
      const u = await UserModel.findOne({ id: out.userId }).lean();
      out.user = normalizeDoc(u);
      out.User = out.user;
    }
  } else if (modelName === "Follow") {
    if (include.trader || include.Trader) {
      const t = await TraderModel.findOne({ id: out.traderId }).lean();
      out.trader = normalizeDoc(t);
      out.Trader = out.trader;
    }
    if (include.user || include.User) {
      const u = await UserModel.findOne({ id: out.userId }).lean();
      out.user = normalizeDoc(u);
      out.User = out.user;
    }
  } else if (modelName === "LeaderSwap") {
    if (include.trader || include.Trader) {
      const t = await TraderModel.findOne({ id: out.traderId }).lean();
      out.trader = normalizeDoc(t);
      out.Trader = out.trader;
    }
  } else if (modelName === "CopyOrder") {
    if (include.swap || include.LeaderSwap) {
      const s = await LeaderSwapModel.findOne({ id: out.swapId }).lean();
      out.swap = normalizeDoc(s);
      out.LeaderSwap = out.swap;
    }
    if (include.follow || include.Follow) {
      const f = await FollowModel.findOne({ id: out.followId }).lean();
      const followPopulated = normalizeDoc(f);
      if (followPopulated && (include.follow?.include || include.Follow?.include)) {
        const fInc = include.follow?.include || include.Follow?.include;
        if (fInc.trader || fInc.Trader) {
          const t = await TraderModel.findOne({ id: followPopulated.traderId }).lean();
          followPopulated.trader = normalizeDoc(t);
          followPopulated.Trader = followPopulated.trader;
        }
        if (fInc.user || fInc.User) {
          const u = await UserModel.findOne({ id: followPopulated.userId }).lean();
          followPopulated.user = normalizeDoc(u);
          followPopulated.User = followPopulated.user;
        }
      }
      out.follow = followPopulated;
      out.Follow = out.follow;
    }
  }

  return out;
}

function createModelAdapter<T>(model: Model<any>, modelName: string) {
  return {
    async findUnique(args: { where: any; include?: any; select?: any }): Promise<T | null> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      const doc = await model.findOne(filter).lean();
      if (!doc) return null;
      const include = args.include ?? includeFromSelect(args.select);
      return populateIncludes(doc, include, modelName);
    },

    async findUniqueOrThrow(args: { where: any; include?: any; select?: any }): Promise<T> {
      await ensureConnected();
      const res = await this.findUnique(args);
      if (!res) throw new Error(`Record not found in ${modelName}`);
      return res;
    },

    async findFirst(args?: {
      where?: any;
      orderBy?: any;
      include?: any;
      select?: any;
    }): Promise<T | null> {
      await ensureConnected();
      const filter = translateWhere(args?.where);
      let q = model.findOne(filter);
      if (args?.orderBy) q = q.sort(translateOrderBy(args.orderBy));
      const doc = await q.lean();
      if (!doc) return null;
      const include = args?.include ?? includeFromSelect(args?.select);
      return populateIncludes(doc, include, modelName);
    },

    async findMany(args?: {
      where?: any;
      orderBy?: any;
      take?: number;
      skip?: number;
      include?: any;
      select?: any;
    }): Promise<T[]> {
      await ensureConnected();
      let filter = translateWhere(args?.where);

      if (modelName === "Trader" && args?.where?.follows?.some?.active) {
        const activeFollows = await FollowModel.find({ active: true })
          .select("traderId")
          .lean();
        const traderIds = [...new Set(activeFollows.map((f: any) => f.traderId))];
        filter = { ...filter, id: { $in: traderIds } };
        delete filter.follows;
      }

      let q = model.find(filter);
      if (args?.orderBy) q = q.sort(translateOrderBy(args.orderBy));
      if (args?.skip) q = q.skip(args.skip);
      if (args?.take) q = q.limit(args.take);

      const docs = await q.lean();
      const include = args?.include ?? includeFromSelect(args?.select);
      if (include) {
        return Promise.all(
          docs.map((d: any) => populateIncludes(d, include, modelName))
        );
      }
      return docs.map(normalizeDoc);
    },

    async create(args: { data: any; include?: any; select?: any }): Promise<T> {
      await ensureConnected();
      const id = args.data.id || args.data._id || randomUUID();
      const data = { ...args.data, id, _id: id };
      const created = await model.create(data);
      const doc = created.toObject ? created.toObject() : created;
      const include = args.include ?? includeFromSelect(args.select);
      if (include) {
        return populateIncludes(doc, include, modelName);
      }
      return normalizeDoc(doc);
    },

    async createMany(args: { data: any[]; skipDuplicates?: boolean }): Promise<{ count: number }> {
      await ensureConnected();
      const docs = args.data.map((d: any) => {
        const id = d.id || d._id || randomUUID();
        return { ...d, id, _id: id };
      });
      const res = await model.insertMany(docs, { ordered: false });
      return { count: res.length };
    },

    async update(args: { where: any; data: any; include?: any; select?: any }): Promise<T> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      const updateData = flattenData(args.data);
      const updated = await model
        .findOneAndUpdate(filter, updateData, { returnDocument: "after" })
        .lean();
      if (!updated) throw new Error(`Record to update not found for ${modelName}`);
      const include = args.include ?? includeFromSelect(args.select);
      if (include) {
        return populateIncludes(updated, include, modelName);
      }
      return normalizeDoc(updated);
    },

    async updateMany(args: { where?: any; data: any }): Promise<{ count: number }> {
      await ensureConnected();
      const filter = translateWhere(args?.where);
      const updateData = flattenData(args.data);
      const res = await model.updateMany(filter, updateData);
      return { count: res.modifiedCount };
    },

    async upsert(args: {
      where: any;
      create: any;
      update: any;
      include?: any;
      select?: any;
    }): Promise<T> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      const include = args.include ?? includeFromSelect(args.select);
      const existing = await model.findOne(filter).lean();
      if (existing) {
        const updateData = flattenData(args.update);
        const updated = await model
          .findOneAndUpdate(filter, updateData, { returnDocument: "after" })
          .lean();
        if (include) return populateIncludes(updated, include, modelName);
        return normalizeDoc(updated);
      } else {
        const id = args.create.id || args.create._id || filter.id || randomUUID();
        const data = { ...args.create, id, _id: id };
        try {
          const created = await model.create(data);
          const doc = created.toObject ? created.toObject() : created;
          if (include) return populateIncludes(doc, include, modelName);
          return normalizeDoc(doc);
        } catch (err: any) {
          if (err.code === 11000 || err.name === "MongoServerError") {
            const updateData = flattenData(args.update);
            const updated = await model
              .findOneAndUpdate(filter, updateData, { returnDocument: "after" })
              .lean();
            if (updated) {
              if (include) return populateIncludes(updated, include, modelName);
              return normalizeDoc(updated);
            }
          }
          throw err;
        }
      }
    },

    async delete(args: { where: any }): Promise<T> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      const deleted = await model.findOneAndDelete(filter).lean();
      return normalizeDoc(deleted);
    },

    async deleteMany(args?: { where?: any }): Promise<{ count: number }> {
      await ensureConnected();
      const filter = translateWhere(args?.where);
      const res = await model.deleteMany(filter);
      return { count: res.deletedCount };
    },

    async count(args?: { where?: any }): Promise<number> {
      await ensureConnected();
      const filter = translateWhere(args?.where);
      return model.countDocuments(filter);
    },

    async aggregate(args: { _sum?: any; where?: any }): Promise<{ _sum: any }> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      if (args._sum) {
        const sumFields: any = {};
        for (const field of Object.keys(args._sum)) {
          sumFields[field] = { $sum: `$${field}` };
        }
        const pipeline: any[] = [];
        if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
        pipeline.push({ $group: { _id: null, ...sumFields } });
        const res = await model.aggregate(pipeline);
        const sumResult: any = {};
        for (const field of Object.keys(args._sum)) {
          sumResult[field] = res[0]?.[field] ?? 0n;
        }
        return { _sum: sumResult };
      }
      return { _sum: {} };
    },

    async groupBy(args: {
      by: string[];
      where?: any;
      _count?: any;
    }): Promise<any[]> {
      await ensureConnected();
      const filter = translateWhere(args.where);
      const groupFields: any = {};
      for (const field of args.by) {
        groupFields[field] = `$${field}`;
      }
      const pipeline: any[] = [];
      if (Object.keys(filter).length > 0) pipeline.push({ $match: filter });
      pipeline.push({
        $group: {
          _id: groupFields,
          _all: { $sum: 1 },
        },
      });
      const res = await model.aggregate(pipeline);
      return res.map((item: any) => {
        const out: any = { ...item._id };
        if (args._count) {
          out._count = { _all: item._all };
        }
        return out;
      });
    },
  };
}

export const db = {
  user: createModelAdapter<User>(UserModel, "User"),
  wallet: createModelAdapter<Wallet>(WalletModel, "Wallet"),
  trader: createModelAdapter<Trader>(TraderModel, "Trader"),
  follow: createModelAdapter<Follow>(FollowModel, "Follow"),
  leaderSwap: createModelAdapter<LeaderSwap>(LeaderSwapModel, "LeaderSwap"),
  copyOrder: createModelAdapter<CopyOrder>(CopyOrderModel, "CopyOrder"),
  paperPosition: createModelAdapter<PaperPosition>(PaperPositionModel, "PaperPosition"),
  livePosition: createModelAdapter<LivePosition>(LivePositionModel, "LivePosition"),
  withdrawal: createModelAdapter<Withdrawal>(WithdrawalModel, "Withdrawal"),
  ledgerEntry: createModelAdapter<LedgerEntry>(LedgerEntryModel, "LedgerEntry"),
  setting: createModelAdapter<Setting>(SettingModel, "Setting"),
  auditLog: createModelAdapter<AuditLog>(AuditLogModel, "AuditLog"),
  plan: createModelAdapter<SubscriptionPlan>(PlanModel, "Plan"),

  async $queryRaw(strings: TemplateStringsArray | string, ...values: any[]): Promise<any> {
    await ensureConnected();
    if (mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
    }
    return [{ 1: 1 }];
  },

  async $queryRawUnsafe<T = any>(query: string, ...values: any[]): Promise<T> {
    await ensureConnected();
    if (mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
    }
    return [] as unknown as T;
  },
};
