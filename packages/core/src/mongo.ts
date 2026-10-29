import mongoose from "mongoose";
import { connectDB, closeDB } from "./db";

export { connectDB, closeDB };

/**
 * Convenience helper returning the underlying native MongoDB driver client and database.
 */
export async function mongo() {
  await connectDB();
  return {
    client: mongoose.connection.getClient(),
    db: mongoose.connection.db!,
  };
}
